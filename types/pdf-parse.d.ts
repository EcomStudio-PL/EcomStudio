declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = { text: string; numpages: number; info: unknown };
  export default function pdfParse(
    data: Buffer,
    options?: { max?: number },
  ): Promise<PdfParseResult>;
}
