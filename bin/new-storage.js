#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get image URL from command line argument or clipboard
let imageUrl = process.argv[2];
let clipboardImage = null;

if (!imageUrl) {
  console.log('No URL provided, reading from clipboard...');
  try {
    // Try to get image data from clipboard first
    try {
      const imageData = execSync('xclip -selection clipboard -t image/png -o', { 
        encoding: null,
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      if (imageData && imageData.length > 0) {
        console.log('Found image data in clipboard');
        clipboardImage = imageData;
      }
    } catch {
      // No image data, try text/URL
      try {
        imageUrl = execSync('xclip -selection clipboard -o', { 
          encoding: 'utf8',
          timeout: 1000
        }).trim();
        if (!imageUrl) {
          console.error('Clipboard is empty!');
          process.exit(1);
        }
        console.log(`Using URL from clipboard: ${imageUrl}`);
      } catch {
        // Fallback to xsel
        try {
          imageUrl = execSync('xsel --clipboard --output', { 
            encoding: 'utf8',
            timeout: 1000
          }).trim();
          if (!imageUrl) {
            console.error('Clipboard is empty!');
            process.exit(1);
          }
          console.log(`Using URL from clipboard: ${imageUrl}`);
        } catch {
          console.error('Failed to read clipboard. Please install xclip or xsel:');
          console.error('  sudo apt-get install xclip');
          console.error('  or');
          console.error('  sudo apt-get install xsel');
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error('Failed to read clipboard:', error.message);
    console.error('Usage: node new-storage.js <image-url>');
    process.exit(1);
  }
}

// Validate URL format if using URL
if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
  console.error('Invalid URL. Must start with http:// or https://');
  process.exit(1);
}

// Get the root directory (parent of bin/)
const rootDir = path.join(__dirname, '..');
const itemsDir = path.join(rootDir, 'items');

// Ensure items directory exists
if (!fs.existsSync(itemsDir)) {
  fs.mkdirSync(itemsDir, { recursive: true });
}

// Count existing numbered folders
function getNextFolderNumber() {
  const items = fs.readdirSync(itemsDir);
  const numbers = items
    .filter(item => {
      const fullPath = path.join(itemsDir, item);
      return fs.statSync(fullPath).isDirectory() && /^\d+$/.test(item);
    })
    .map(item => parseInt(item, 10));
  
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

// Download image from URL
function downloadImage(url, destination) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': url,
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    };
    
    protocol.get(url, options, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        downloadImage(response.headers.location, destination)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(destination);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

// Main execution
(async () => {
  try {
    // Get next folder number
    const nextNumber = getNextFolderNumber();
    const newFolderPath = path.join(itemsDir, nextNumber.toString());
    
    // Create new folder
    fs.mkdirSync(newFolderPath, { recursive: true });
    console.log(`Created folder: ${nextNumber}`);
    
    let tempPath;
    
    if (clipboardImage) {
      // Save clipboard image directly
      tempPath = path.join(newFolderPath, 'temp_clipboard.png');
      fs.writeFileSync(tempPath, clipboardImage);
      console.log('Saved image from clipboard');
    } else {
      // Download to temporary location
      tempPath = path.join(newFolderPath, 'temp_download');
      console.log(`Downloading image from: ${imageUrl}`);
      await downloadImage(imageUrl, tempPath);
    }
    
    // Convert to JPG and save as "1.jpg"
    const finalPath = path.join(newFolderPath, '1.jpg');
    console.log('Converting to JPG format...');
    await sharp(tempPath)
      .jpeg({ quality: 90 })
      .toFile(finalPath);
    
    // Remove temporary file
    fs.unlinkSync(tempPath);
    console.log(`Image saved to: items/${nextNumber}/1.jpg`);
    
    // Git operations
    console.log('Adding to git...');
    execSync(`git add items/${nextNumber}`, { cwd: rootDir, stdio: 'inherit' });
    
    console.log('Committing...');
    execSync(`git commit -m "${nextNumber}"`, { cwd: rootDir, stdio: 'inherit' });
    
    console.log('Pushing to remote...');
    execSync('git push', { cwd: rootDir, stdio: 'inherit' });
    
    console.log('Done!');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
