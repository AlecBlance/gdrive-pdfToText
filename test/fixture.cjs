// Small, deterministic text PDFs; no third-party files or live Drive dependency.
const { createHash } = require("node:crypto");

// Legacy PDF Standard Security (R2), used only to generate password test data.
function rc4(key, bytes) {
    const state = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + state[i] + key[i % key.length]) % 256;
        [state[i], state[j]] = [state[j], state[i]];
    }
    let i = 0;
    j = 0;
    return Buffer.from(bytes.map(byte => {
        i = (i + 1) % 256;
        j = (j + state[i]) % 256;
        [state[i], state[j]] = [state[j], state[i]];
        return byte ^ state[(state[i] + state[j]) % 256];
    }));
}

function pdfFixture(pages = ["Hello PDF", "Second page"], password) {
    const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
    const md5 = bytes => createHash("md5").update(bytes).digest();
    const pad = value => Buffer.concat([Buffer.from(value, "latin1"), padding]).subarray(0, 32);
    const fileId = Buffer.alloc(16, 1);
    const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad(password ?? ""));
    const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]); // P = -4
    const key = md5(Buffer.concat([pad(password ?? ""), owner, permissions, fileId])).subarray(0, 5);
    const objects = [];
    const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    pages.forEach((text, i) => {
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
        const escaped = text.replace(/[\\()]/g, "\\$&");
        let stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
        if (password !== undefined) {
            const objectNumber = Buffer.alloc(5);
            objectNumber.writeUIntLE(5 + i * 2, 0, 3);
            const streamKey = md5(Buffer.concat([key, objectNumber])).subarray(0, 10);
            stream = rc4(streamKey, Buffer.from(stream, "latin1")).toString("latin1");
        }
        objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    });
    let encryption = "";
    if (password !== undefined) {
        objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${rc4(key, padding).toString("hex")}> /P -4 >>`);
        encryption = `/Encrypt ${objects.length} 0 R /ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>]`;
    }
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, i) => {
        offsets.push(Buffer.byteLength(pdf, "latin1"));
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryption} >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "latin1");
}

module.exports = { pdfFixture };
