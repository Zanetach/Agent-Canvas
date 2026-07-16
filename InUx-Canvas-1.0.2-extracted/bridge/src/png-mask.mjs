import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("图片不是有效的 PNG");
  }
  let offset = 8;
  let header = null;
  const imageChunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("PNG 数据不完整");
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      imageChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header || !imageChunks.length) throw new Error("PNG 缺少图像数据");
  const channels = CHANNELS.get(header.colorType);
  if (
    ![8, 16].includes(header.bitDepth) ||
    !channels ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    header.interlace !== 0
  ) {
    throw new Error("Mask 严格合成仅支持可规范化的 8/16-bit 非交错 PNG");
  }

  const bytesPerSample = header.bitDepth / 8;
  const bytesPerPixel = channels * bytesPerSample;
  const rowBytes = header.width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(imageChunks));
  if (inflated.length !== (rowBytes + 1) * header.height) {
    throw new Error("PNG 像素数据尺寸无效");
  }
  const pixels = Buffer.alloc(rowBytes * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const sourceRow = y * (rowBytes + 1);
    const targetRow = y * rowBytes;
    const filterType = inflated[sourceRow];
    if (filterType > 4) throw new Error("PNG 使用了不支持的过滤器");
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[sourceRow + 1 + x];
      const left = x >= bytesPerPixel ? pixels[targetRow + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[targetRow - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[targetRow - rowBytes + x - bytesPerPixel]
        : 0;
      const predictor = filterType === 1
        ? left
        : filterType === 2
          ? above
          : filterType === 3
            ? Math.floor((left + above) / 2)
            : filterType === 4
              ? paeth(left, above, upperLeft)
              : 0;
      pixels[targetRow + x] = (encoded + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  const sample = (index) => header.bitDepth === 16
    ? Math.round(pixels.readUInt16BE(index) / 257)
    : pixels[index];
  for (
    let sourceIndex = 0, targetIndex = 0;
    sourceIndex < pixels.length;
    sourceIndex += bytesPerPixel
  ) {
    if (header.colorType === 0 || header.colorType === 4) {
      rgba[targetIndex] = sample(sourceIndex);
      rgba[targetIndex + 1] = sample(sourceIndex);
      rgba[targetIndex + 2] = sample(sourceIndex);
      rgba[targetIndex + 3] = header.colorType === 4
        ? sample(sourceIndex + bytesPerSample)
        : 255;
    } else {
      rgba[targetIndex] = sample(sourceIndex);
      rgba[targetIndex + 1] = sample(sourceIndex + bytesPerSample);
      rgba[targetIndex + 2] = sample(sourceIndex + 2 * bytesPerSample);
      rgba[targetIndex + 3] = header.colorType === 6
        ? sample(sourceIndex + 3 * bytesPerSample)
        : 255;
    }
    targetIndex += 4;
  }
  return { width: header.width, height: header.height, colorType: header.colorType, rgba };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function encodeRgbaPng({ width, height, rgba }) {
  if (rgba.length !== width * height * 4) throw new Error("RGBA 像素数据尺寸无效");
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const targetRow = y * (width * 4 + 1);
    raw[targetRow] = 0;
    rgba.copy(raw, targetRow + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function compositePngWithAlphaMask({ source, generated, mask }) {
  const sourceImage = decodePng(source);
  const generatedImage = decodePng(generated);
  const maskImage = decodePng(mask);
  const dimensions = [sourceImage, generatedImage, maskImage].map(
    ({ width, height }) => `${width}x${height}`,
  );
  if (new Set(dimensions).size !== 1) {
    throw new Error("Mask、源图片与生成结果的尺寸必须一致");
  }

  const rgba = Buffer.alloc(sourceImage.rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const preserveWeight = maskImage.rgba[index + 3] / 255;
    const generatedWeight = 1 - preserveWeight;
    for (let channel = 0; channel < 4; channel += 1) {
      rgba[index + channel] = Math.round(
        sourceImage.rgba[index + channel] * preserveWeight +
          generatedImage.rgba[index + channel] * generatedWeight,
      );
    }
  }
  return encodeRgbaPng({ width: sourceImage.width, height: sourceImage.height, rgba });
}
