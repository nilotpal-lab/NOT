import crypto from "crypto";

/**
 * Valid minimal PDF buffer conforming to PDF 1.4 spec.
 * Starts with '%PDF-1.4' at byte 0 and ends with '%%EOF'.
 */
export const VALID_MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [] /Count 0 >>
endobj
xref
0 3
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
trailer
<< /Size 3 /Root 1 0 R >>
startxref
115
%%EOF
`,
  "utf-8"
);

/**
 * Corrupted / truncated PDF starting with %PDF-1.4 but missing %%EOF at the end.
 */
export const TRUNCATED_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [] /Count 0 >>
endobj
`,
  "utf-8"
);

/**
 * Executable binary header (MZ DOS header) pretending to be a PDF or PPTX.
 */
export const FAKE_EXE_HEADER = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  0xff, 0xff, 0x00, 0x00, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * Creates a minimal valid ZIP buffer containing [Content_Types].xml
 * with presentationml content type to satisfy PPTX stream validation.
 */
export function createMinimalValidPptx(): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;
  const xmlBuf = Buffer.from(contentTypesXml, "utf-8");

  // Construct a minimal standard PKZIP structure in memory
  const fileName = "[Content_Types].xml";
  const fileNameBuf = Buffer.from(fileName, "utf-8");

  // Local file header (30 bytes + name + content)
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // compression: 0 (stored)
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc-32 (0 for mock)
  localHeader.writeUInt32LE(xmlBuf.length, 18); // compressed size
  localHeader.writeUInt32LE(xmlBuf.length, 22); // uncompressed size
  localHeader.writeUInt16LE(fileNameBuf.length, 26); // file name length
  localHeader.writeUInt16LE(0, 28); // extra field length

  const localFileRecord = Buffer.concat([localHeader, fileNameBuf, xmlBuf]);

  // Central directory header (46 bytes + name)
  const centralDirHeader = Buffer.alloc(46);
  centralDirHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02 signature
  centralDirHeader.writeUInt16LE(20, 4); // version made by
  centralDirHeader.writeUInt16LE(20, 6); // version needed
  centralDirHeader.writeUInt16LE(0, 8); // flags
  centralDirHeader.writeUInt16LE(0, 10); // compression: 0
  centralDirHeader.writeUInt16LE(0, 12); // mod time
  centralDirHeader.writeUInt16LE(0, 14); // mod date
  centralDirHeader.writeUInt32LE(0, 16); // crc-32
  centralDirHeader.writeUInt32LE(xmlBuf.length, 20); // compressed size
  centralDirHeader.writeUInt32LE(xmlBuf.length, 24); // uncompressed size
  centralDirHeader.writeUInt16LE(fileNameBuf.length, 28); // file name length
  centralDirHeader.writeUInt16LE(0, 30); // extra field length
  centralDirHeader.writeUInt16LE(0, 32); // comment length
  centralDirHeader.writeUInt16LE(0, 34); // disk number start
  centralDirHeader.writeUInt16LE(0, 36); // internal attrs
  centralDirHeader.writeUInt32LE(0, 38); // external attrs
  centralDirHeader.writeUInt32LE(0, 42); // relative offset of local header

  const centralDirRecord = Buffer.concat([centralDirHeader, fileNameBuf]);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06 signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(1, 8); // records on disk
  eocd.writeUInt16LE(1, 10); // total records
  eocd.writeUInt32LE(centralDirRecord.length, 12); // central dir size
  eocd.writeUInt32LE(localFileRecord.length, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localFileRecord, centralDirRecord, eocd]);
}

/**
 * Creates a deterministic byte buffer with specific size and byte pattern.
 */
export function createDeterministicBuffer(sizeBytes: number, seed = 0x42): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  let s = seed & 0xff;
  for (let i = 0; i < sizeBytes; i += 4096) {
    const end = Math.min(i + 4096, sizeBytes);
    buf.fill(s++, i, end);
    if (s > 0xfe) s = 0x10;
  }
  return buf;
}

/**
 * Computes hexadecimal SHA-256 string for any Buffer or Uint8Array.
 */
export function sha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
