import { App, TFile, TFolder, Notice, requestUrl, normalizePath } from 'obsidian';
import { LegoSet, AdditionalImage, FailedSetEntry } from './types';

function generateBaseFileContent(folderName: string): string {
	return `formulas:
  Untitled: ""
views:
  - type: cards
    name: View
    filters:
      and:
        - file.inFolder("${folderName}")
        - '!file.path.contains("images")'
        - and:
            - file.name != "${folderName}.base"
    order:
      - file.name
      - theme
      - subtheme
      - year
      - pieces
      - tags
    sort:
      - property: file.name
        direction: ASC
      - property: setNumber
        direction: ASC
    cardSize: 180
    image: note.cover
    imageAspectRatio: 1
    imageFit: contain
`;
}

export function sanitizeFileName(fileName: string): string {
	return fileName.replaceAll(/[\\/:*?"<>|]/g, '_');
}

export function buildSetPaths(legoSetsFolder: string, set: { number: string; name: string; theme: string }) {
	const themeFolderPath = normalizePath(`${legoSetsFolder}/${sanitizeFileName(set.theme)}`);
	const setFolderName = sanitizeFileName(`${set.number} - ${set.name}`);
	const setFolderPath = normalizePath(`${themeFolderPath}/${setFolderName}`);
	const filePath = normalizePath(`${setFolderPath}/${setFolderName}.md`);
	const imagesFolderPath = normalizePath(`${setFolderPath}/images`);
	return { themeFolderPath, setFolderPath, filePath, setFolderName, imagesFolderPath };
}

export class NoteCreator {
	constructor(private readonly app: App, private readonly legoSetsFolder: string) {}

	/**
	 * Create a note for a LEGO set with organized folder structure and local images
	 */
	async createSetNote(set: LegoSet, additionalImages: AdditionalImage[]): Promise<TFile> {
		const { themeFolderPath, setFolderPath, filePath, imagesFolderPath } = buildSetPaths(this.legoSetsFolder, set);

		await this.ensureFolderExists(this.legoSetsFolder);
		await this.ensureFolderExists(themeFolderPath);
		await this.ensureFolderExists(setFolderPath);
		await this.ensureFolderExists(imagesFolderPath);

		const localMainImage = await this.downloadImage(set.image?.imageURL, imagesFolderPath, 'main.jpg');
		const relativeMainImage = localMainImage ? 'images/main.jpg' : null;
		const localAdditionalImages = await this.downloadAdditionalImages(additionalImages, imagesFolderPath);

		const content = this.generateNoteContent(set, relativeMainImage, localAdditionalImages);

		const label = `${set.number} - ${set.name}`;
		await this.writeNoteFile(filePath, content, label);

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`Failed to create note at ${filePath}`);
		}
		return file;
	}

	/**
	 * Write a sync log file listing all sets that failed to sync.
	 * Creates or overwrites `{legoSetsFolder}/sync-log.md`.
	 */
	async writeSyncLog(failedSets: FailedSetEntry[], syncTimestamp: number): Promise<void> {
		const logPath = normalizePath(`${this.legoSetsFolder}/sync-log.md`);
		const date = new Date(syncTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

		const lines: string[] = [
			'# Sync Log',
			'',
			`**Last sync:** ${date}`,
			'',
		];

		if (failedSets.length === 0) {
			lines.push('✅ All sets synced successfully.', '');
		} else {
			lines.push(
				`⚠️ **${failedSets.length} set${failedSets.length === 1 ? '' : 's'} failed to sync:**`,
				'',
				'| Set Number | Name | Theme | Error |',
				'|---|---|---|---|',
			);
			for (const entry of failedSets) {
				const safeError = entry.error.replaceAll('|', String.raw`\|`);
				lines.push(`| ${entry.setNumber} | ${entry.name} | ${entry.theme} | ${safeError} |`);
			}
			lines.push('');
		}

		await this.writeNoteFile(logPath, lines.join('\n'), 'sync-log');
	}

	/**
	 * Download additional images and return their relative paths
	 */
	private async downloadAdditionalImages(
		additionalImages: AdditionalImage[],
		imagesFolderPath: string
	): Promise<string[]> {
		const downloads = additionalImages.map((img, i) =>
			this.downloadImage(img.imageURL, imagesFolderPath, `additional-${i + 1}.jpg`)
				.then(path => path ? `images/additional-${i + 1}.jpg` : null)
		);
		const results = await Promise.all(downloads);
		return results.filter((p): p is string => p !== null);
	}

	/**
	 * Write (create or update) a note file, handling race conditions gracefully
	 */
	private async writeNoteFile(filePath: string, content: string, label: string): Promise<void> {
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, content);
			new Notice(`Updated: ${label}`);
			return;
		}

		try {
			await this.app.vault.create(filePath, content);
			new Notice(`Created: ${label}`);
		} catch (error) {
			const errorMessage = error?.message || String(error);
			if (!errorMessage.includes('already exists')) {
				throw error;
			}
			// File was created by another process — update it
			const fileNow = this.app.vault.getAbstractFileByPath(filePath);
			if (fileNow instanceof TFile) {
				await this.app.vault.modify(fileNow, content);
				new Notice(`Updated: ${label}`);
			} else {
				throw error;
			}
		}
	}

	/**
	 * Download an image from URL and save it locally
	 */
	private async downloadImage(
		imageUrl: string | undefined,
		folderPath: string,
		fileName: string
	): Promise<string | null> {
		if (!imageUrl) return null;

		try {
			const filePath = normalizePath(`${folderPath}/${fileName}`);
			
			// Check if image already exists
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			if (existingFile) {
				return filePath;
			}

			const response = await requestUrl({
				url: imageUrl,
				method: 'GET'
			});

			const contentType = response.headers?.['content-type'] ?? '';
			if (contentType && !contentType.startsWith('image/')) {
				console.warn('Skipping non-image response (%s) from %s', contentType, imageUrl);
				return null;
			}

			try {
				await this.app.vault.createBinary(filePath, response.arrayBuffer);
			} catch (error) {
				// Check if error is "File already exists"
				const errorMessage = error?.message || String(error);
				if (errorMessage.includes('File already exists') || errorMessage.includes('already exists')) {
					// File was created by another process, that's fine
					return filePath;
				}
				throw error; // Re-throw if it's a real error
			}
			
			return filePath;
		} catch (error) {
			console.error("Failed to download image from %s:", imageUrl, error);
			return null;
		}
	}

	/**
	 * Generate markdown content for a LEGO set with local image paths
	 */
	private generateNoteContent(
		set: LegoSet,
		localMainImage: string | null,
		localAdditionalImages: string[]
	): string {
		const lines: string[] = [
			...this.buildFrontmatter(set, localMainImage),
			...this.buildDetailsSection(set),
			...this.buildDescriptionSection(set),
			...this.buildDimensionsSection(set),
			...this.buildAdditionalImagesSection(localAdditionalImages),
			...this.buildLinksSection(set),
		];

		return lines.join('\n');
	}

	/**
	 * Build the YAML frontmatter lines for a LEGO set note
	 */
	private buildFrontmatter(set: LegoSet, localMainImage: string | null): string[] {
		const lines: string[] = [];
		const tags = ['lego', 'set', this.sanitizeTag(set.theme)];
		if (set.subtheme) {
			tags.push(this.sanitizeTag(set.subtheme));
		}

		lines.push(
			'---',
			`tags: [${tags.join(', ')}]`,
			`setID: ${set.setID}`,
			`setNumber: "${set.number}"`,
			`theme: "${this.escapeYaml(set.theme)}"`,
		);
		if (set.subtheme) {
			lines.push(`subtheme: "${this.escapeYaml(set.subtheme)}"`);
		}
		lines.push(`year: ${set.year}`);
		if (set.pieces) {
			lines.push(`pieces: ${set.pieces}`);
		}
		if (set.minifigs) {
			lines.push(`minifigs: ${set.minifigs}`);
		}

		this.buildCollectionFrontmatter(set, lines);

		if (localMainImage) {
			lines.push(`cover: "[[${localMainImage}]]"`);
		}
		lines.push('---', '', `# ${set.number}: ${set.name}`, '');

		if (localMainImage) {
			lines.push(`![${set.name}](${localMainImage})`, '');
		}

		return lines;
	}

	/**
	 * Append collection status lines to the frontmatter
	 */
	private buildCollectionFrontmatter(set: LegoSet, lines: string[]): void {
		const collection = set.collection;
		lines.push(
			`owned: ${collection?.owned ?? false}`,
			`wanted: ${collection?.wanted ?? false}`,
		);
		// Use != null so that qtyOwned: 0 and rating: 0 are written correctly
		if (collection?.qtyOwned != null) lines.push(`qtyOwned: ${collection.qtyOwned}`);
		if (collection?.rating    != null) lines.push(`userRating: ${collection.rating}`);
	}

	/**
	 * Build the Details section lines for a LEGO set note
	 */
	private buildDetailsSection(set: LegoSet): string[] {
		const lines: string[] = [
			'## Details',
			'',
			`- **Set Number:** ${set.number}`,
			`- **Name:** ${set.name}`,
			`- **Theme:** ${set.theme}`,
		];
		if (set.subtheme) {
			lines.push(`- **Subtheme:** ${set.subtheme}`);
		}
		lines.push(`- **Year Released:** ${set.year}`);
		if (set.pieces) {
			lines.push(`- **Pieces:** ${set.pieces.toLocaleString()}`);
		}
		if (set.minifigs) {
			lines.push(`- **Minifigs:** ${set.minifigs}`);
		}

		const rrpLine = this.buildRrpLine(set);
		if (rrpLine) {
			lines.push(rrpLine);
		}

		if (set.rating) {
			lines.push(`- **Rating:** ${set.rating.toFixed(1)}/5`);
			if (set.reviewCount) {
				lines.push(`- **Reviews:** ${set.reviewCount}`);
			}
		}
		if (set.packagingType) {
			lines.push(`- **Packaging:** ${set.packagingType}`);
		}
		if (set.availability) {
			lines.push(`- **Availability:** ${set.availability}`);
		}
		if (set.ageRange?.min) {
			const ageText = set.ageRange.max
				? `${set.ageRange.min}-${set.ageRange.max}`
				: `${set.ageRange.min}+`;
			lines.push(`- **Age Range:** ${ageText}`);
		}
		lines.push('');

		return lines;
	}

	/**
	 * Return the first available RRP detail line, or null if none found
	 */
	private buildRrpLine(set: LegoSet): string | null {
		if (!set.LEGOCom) return null;
		const regions = ['US', 'UK', 'CA', 'DE'] as const;
		for (const region of regions) {
			const regionData = set.LEGOCom[region];
			if (regionData?.retailPrice) {
				const currency = this.getCurrencySymbol(region);
				return `- **RRP (${region}):** ${currency}${regionData.retailPrice.toFixed(2)}`;
			}
		}
		return null;
	}

	/**
	 * Build the Description section lines (empty array if no description)
	 */
	private buildDescriptionSection(set: LegoSet): string[] {
		if (!set.extendedData?.description) return [];
		return ['## Description', '', set.extendedData.description, ''];
	}

	/**
	 * Build the Dimensions section lines (empty array if no dimensions)
	 */
	private buildDimensionsSection(set: LegoSet): string[] {
		const dim = set.dimensions;
		if (!dim || (!dim.height && !dim.width && !dim.depth)) return [];

		const lines: string[] = ['## Dimensions', ''];
		if (dim.height) lines.push(`- **Height:** ${dim.height} cm`);
		if (dim.width)  lines.push(`- **Width:** ${dim.width} cm`);
		if (dim.depth)  lines.push(`- **Depth:** ${dim.depth} cm`);
		if (dim.weight) lines.push(`- **Weight:** ${dim.weight} kg`);
		lines.push('');

		return lines;
	}

	/**
	 * Build the Additional Images section lines (empty array if none)
	 */
	private buildAdditionalImagesSection(localAdditionalImages: string[]): string[] {
		if (localAdditionalImages.length === 0) return [];

		return [
			'## Additional Images', '',
			...localAdditionalImages.flatMap((img, i) => [`![Additional Image ${i + 1}](${img})`, '']),
		];
	}

	/**
	 * Build the Links and Notes section lines
	 */
	private buildLinksSection(set: LegoSet): string[] {
		const brickLinkNumber = set.number.replaceAll('-', '');
		return [
			'## Links',
			'',
			`- [Brickset Page](${set.bricksetURL})`,
			`- [BrickLink](https://www.bricklink.com/v2/catalog/catalogitem.page?S=${brickLinkNumber}-1)`,
			`- [Rebrickable](https://rebrickable.com/sets/${set.number}-1/)`,
			'', '## Notes', '', '<!-- Add your personal notes here -->', ''
		];
	}

	/**
	 * Ensure the .base file exists inside the LEGO Sets folder.
	 */
	async ensureBaseFile(): Promise<void> {
		await this.ensureFolderExists(this.legoSetsFolder);

		const basePath = normalizePath(`${this.legoSetsFolder}/${this.legoSetsFolder}.base`);

		if (this.app.vault.getAbstractFileByPath(basePath)) return;

		try {
			await this.app.vault.create(basePath, generateBaseFileContent(this.legoSetsFolder));
		} catch (error) {
			if (error instanceof Error && /already exists/i.test(error.message)) return;
			throw error;
		}
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const normalizedPath = normalizePath(folderPath);
		const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
		
		if (!folder) {
			try {
				await this.app.vault.createFolder(normalizedPath);
			} catch (error) {
				// Check if error is "Folder already exists"
				const errorMessage = error?.message || String(error);
				if (errorMessage.includes('Folder already exists')) {
					// This is fine, folder was created by another process
					return;
				}
				
				// For other errors, check if folder exists now
				const folderNow = this.app.vault.getAbstractFileByPath(normalizedPath);
				if (!folderNow || !(folderNow instanceof TFolder)) {
					throw error; // Re-throw if it's a real error
				}
			}
		} else if (!(folder instanceof TFolder)) {
			throw new TypeError(`${normalizedPath} exists but is not a folder`);
		}
	}

	/**
	 * Sanitize a string to be used as a tag
	 */
	private sanitizeTag(tag: string): string {
		if (!tag) return '';
		// Convert to lowercase, replace spaces and special characters with hyphens
		return tag.toLowerCase()
			.replaceAll(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
			.replaceAll(/\s+/g, '-')      // Replace spaces with hyphens
			.replaceAll(/-+/g, '-')       // Replace multiple hyphens with single hyphen
			.replaceAll(/(^-|-$)/g, '');  // Remove leading/trailing hyphens
	}

	/**
	 * Escape special characters in YAML values
	 */
	private escapeYaml(value: string): string {
		if (!value) return '';
		// Escape quotes
		return value.replaceAll('"', String.raw`\"`);
	}

	/**
	 * Get currency symbol for a region
	 */
	private getCurrencySymbol(region: string): string {
		const symbols: Record<string, string> = {
			'US': '$',
			'UK': '£',
			'CA': 'CA$',
			'DE': '€'
		};
		return symbols[region] || '$';
	}
}
