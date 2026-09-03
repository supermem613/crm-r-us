import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inflateRawSync } from "node:zlib";
import { createZip, crc32 } from "../../src/mos3/zip.js";

const SIGNATURE_END = 0x06054b50;

function readEntries(zip: Buffer): Array<{ path: string; content: Buffer }> {
  const endOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(endOffset), SIGNATURE_END, "end of central directory record is present");

  const count = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);
  const entries: Array<{ path: string; content: Buffer }> = [];

  for (let index = 0; index < count; index += 1) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    const path = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const localOffset = zip.readUInt32LE(cursor + 42);

    const method = zip.readUInt16LE(localOffset + 8);
    const crc = zip.readUInt32LE(localOffset + 14);
    const compressedSize = zip.readUInt32LE(localOffset + 18);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const extraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + extraLength;
    const payload = zip.subarray(start, start + compressedSize);
    const content = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);

    assert.equal(crc32(content), crc, `stored CRC matches the payload of ${path}`);
    entries.push({ path, content });
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }

  return entries;
}

describe("zip", () => {
  it("round-trips text and binary entries", () => {
    const text = Buffer.from(JSON.stringify({ hello: "world" }).repeat(40), "utf8");
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const entries = readEntries(createZip([
      { path: "manifest.json", content: text },
      { path: "color.png", content: binary },
    ]));

    assert.deepEqual(entries.map((entry) => entry.path), ["manifest.json", "color.png"]);
    assert.deepEqual(entries[0]!.content, text);
    assert.deepEqual(entries[1]!.content, binary);
  });

  it("produces identical bytes for identical input", () => {
    const entry = { path: "a.txt", content: Buffer.from("same input", "utf8") };
    assert.deepEqual(createZip([entry]), createZip([entry]));
  });

  it("keeps the smaller encoding when deflate would grow the payload", () => {
    const incompressible = Buffer.from([0x00, 0xff]);
    const zip = createZip([{ path: "tiny.bin", content: incompressible }]);

    assert.equal(zip.readUInt16LE(8), 0, "stores the entry without compression");
    assert.deepEqual(readEntries(zip)[0]!.content, incompressible);
  });
});
