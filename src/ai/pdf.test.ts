import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textPdf } from './pdf.ts';

test('textPdf writes a PDF with a correct xref offset', () => {
  const pdf = textPdf('Evidence (PP-D-1)', ['Shipped 2026-11-01 via UPS 1Z999', 'Delivered 2026-11-03']).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  assert.ok(pdf.includes('\\(PP-D-1\\)'));
});
