declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseResult = { text: string; numpages: number; info: unknown };
  export default function pdfParse(
    data: Buffer,
    options?: { max?: number },
  ): Promise<PdfParseResult>;
}

/** The pdf.js build that ships inside pdf-parse (v1.10.100). Only the small
 *  surface lib/server/knowledge-pdf.ts uses is declared. */
declare module "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js" {
  type TextItem = { str: string; transform: number[] };
  type DecodedImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };
  type PdfPage = {
    getTextContent(): Promise<{ items: TextItem[] }>;
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs: { get(id: string, callback: (img: DecodedImage | null) => void): void };
    cleanup(): void;
  };
  type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
  const PDFJS: {
    disableWorker: boolean;
    isEvalSupported: boolean;
    disableFontFace: boolean;
    maxImageSize: number;
    OPS: Record<string, number>;
    getDocument(src: {
      data: Uint8Array; nativeImageDecoderSupport?: string; disableFontFace?: boolean; isEvalSupported?: boolean;
    }): Promise<PdfDocument>;
  };
  export default PDFJS;
}
