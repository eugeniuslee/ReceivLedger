import { RequestError } from './domain.ts';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from 'pdf-lib';
import { MAX_PDF_BYTES } from './domain.ts';

/** Parse bytes server-side. Reject encrypted PDFs, attachments and active actions.
 * This is a limited demo document filter, not an antivirus or identity check. */
export async function validatePdf(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new RequestError('PDFs must be between 1 byte and 5 MB.');
  if (!new TextDecoder().decode(bytes.subarray(0, 5)).startsWith('%PDF-')) throw new RequestError('The file is not a PDF.');
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true }); }
  catch { throw new RequestError('Use a readable, unencrypted fictional PDF.'); }
  if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new RequestError('Use an unencrypted PDF with 1–100 pages.');
  const forbidden = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFiles', 'EmbeddedFile', 'XFA', 'RichMedia', 'SubmitForm', 'ImportData']);
  const visited = new Set<PDFObject>();
  function inspect(object: PDFObject, depth = 0) {
    if (visited.has(object)) return;
    if (depth > 100 || visited.size > 20000) throw new RequestError('PDF structure is too complex.');
    visited.add(object);
    if (object instanceof PDFName && forbidden.has(object.decodeText())) throw new RequestError('PDF actions or embedded content are not allowed.');
    if (object instanceof PDFDict) for (const [key, value] of object.entries()) { inspect(key, depth + 1); inspect(value, depth + 1); }
    else if (object instanceof PDFArray) for (const value of object.asArray()) inspect(value, depth + 1);
    else if (object instanceof PDFStream) inspect(object.dict, depth + 1);
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
}

