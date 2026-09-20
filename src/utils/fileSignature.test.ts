import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReceiptMimeType } from './fileSignature.js';

test('detectReceiptMimeType recognizes every allowed receipt signature', () => {
  assert.equal(detectReceiptMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(
    detectReceiptMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(detectReceiptMimeType(Buffer.from('GIF89a', 'ascii')), 'image/gif');
  assert.equal(detectReceiptMimeType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
  assert.equal(detectReceiptMimeType(Buffer.from('%PDF-1.7', 'ascii')), 'application/pdf');
});

test('detectReceiptMimeType rejects extension-only and unknown content', () => {
  assert.equal(detectReceiptMimeType(Buffer.from('not actually a PDF')), null);
  assert.equal(detectReceiptMimeType(Buffer.alloc(0)), null);
});
