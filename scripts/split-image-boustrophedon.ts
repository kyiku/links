import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function splitImageBoustrophedon(
  inputPath: string,
  outputDir: string,
  gridSize: number = 8
) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  const tileWidth = Math.floor(metadata.width / gridSize);
  const tileHeight = Math.floor(metadata.height / gridSize);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Splitting ${metadata.width}x${metadata.height} image into ${gridSize}x${gridSize} grid`);
  console.log(`Each tile: ${tileWidth}x${tileHeight} pixels`);
  console.log('Using boustrophedon (serpentine) ordering...\n');

  let index = 0;

  for (let row = 0; row < gridSize; row++) {
    const isEvenRow = row % 2 === 0;

    for (let i = 0; i < gridSize; i++) {
      const col = isEvenRow ? i : (gridSize - 1 - i);

      const left = col * tileWidth;
      const top = row * tileHeight;

      const paddedIndex = String(index).padStart(2, '0');
      const outputPath = path.join(outputDir, `tile_${paddedIndex}.png`);

      await sharp(inputPath)
        .extract({
          left: left,
          top: top,
          width: Math.min(tileWidth, metadata.width - left),
          height: Math.min(tileHeight, metadata.height - top)
        })
        .toFile(outputPath);

      const direction = isEvenRow ? '→' : '←';
      console.log(`Row ${row} ${direction} Col ${col}: tile_${paddedIndex}.png (${left},${top})`);

      index++;
    }
  }

  console.log(`\n✅ Successfully created ${index} tiles in ${outputDir}`);
  console.log('\nBoustrophedon pattern visualization:');
  console.log('0→1→2→3→4→5→6→7');
  console.log('15←14←13←12←11←10←9←8');
  console.log('16→17→18→19→20→21→22→23');
  console.log('31←30←29←28←27←26←25←24');
  console.log('32→33→34→35→36→37→38→39');
  console.log('47←46←45←44←43←42←41←40');
  console.log('48→49→50→51→52→53→54→55');
  console.log('63←62←61←60←59←58←57←56');
}

const inputImage = path.join(process.cwd(), 'スクリーンショット 2025-09-14 2.13.38.png');
const outputDirectory = path.join(process.cwd(), 'public/maps/tiles');

splitImageBoustrophedon(inputImage, outputDirectory, 8)
  .then(() => {
    console.log('\nImage splitting complete!');
  })
  .catch((error) => {
    console.error('Error splitting image:', error);
  });