// A tiny streaming PDF writer: one JPEG per page (DCTDecode), page size = image size in points, nothing else on the
// page (no text, no watermark). The output is a list of Blob parts, so the whole file is never held as one
// ArrayBuffer: each page's bytes go in as the Blob the canvas produced and are not copied.
const enc = new TextEncoder();

export class PdfWriter {
  private parts: BlobPart[] = [];
  private offsets: number[] = []; // byte offset of object n (index n - 1)
  private pos = 0;
  private pages = 0;

  constructor() {
    // The comment line with high bytes tells tools the file is binary.
    this.raw("%PDF-1.4\n%âãÏÓ\n");
  }
  private raw(s: string) {
    const b = enc.encode(s);
    this.parts.push(b);
    this.pos += b.length;
  }
  private begin(obj: number) {
    this.offsets[obj - 1] = this.pos;
  }
  get pageCount() { return this.pages; }

  /** Adds one page showing a JPEG. width/height are in pixels and become points 1:1. */
  addJpeg(jpeg: Blob, width: number, height: number) {
    const i = this.pages++;
    const img = 3 + i * 3, content = img + 1, page = img + 2;
    this.begin(img);
    this.raw(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`);
    this.parts.push(jpeg);
    this.pos += jpeg.size;
    this.raw("\nendstream\nendobj\n");
    const draw = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    this.begin(content);
    this.raw(`${content} 0 obj\n<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
    this.begin(page);
    this.raw(`${page} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`);
  }

  /** Writes the page tree, catalog, cross-reference table and trailer, and returns the file. */
  finish(): Blob {
    const n = this.pages;
    this.begin(1);
    this.raw("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    this.begin(2);
    const kids = Array.from({ length: n }, (_, i) => `${5 + i * 3} 0 R`).join(" ");
    this.raw(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${kids}] >>\nendobj\n`);
    const xref = this.pos;
    const size = 3 + n * 3;
    let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let k = 0; k < size - 1; k++) table += `${String(this.offsets[k]).padStart(10, "0")} 00000 n \n`;
    this.raw(`${table}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const blob = new Blob(this.parts, { type: "application/pdf" });
    this.parts = [];
    return blob;
  }
}
