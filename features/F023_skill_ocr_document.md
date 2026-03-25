# F023 — Skill: `ocr_document` (Arabic + English OCR via Sarvam Vision)

**Status:** — (Not yet specced beyond this contract)
**Wave:** 3 (Skills Layer)
**Owner:** Commander + Claude
**Created:** 2026-03-20

---

## 0. Philosophy

> Arabic supplier invoices are the highest-cost manual bottleneck in PH Trading's process. Ramya manually translates. This skill eliminates that bottleneck. A supplier sends an Arabic PDF; Abhie drops it into the chat; the AI reads it, extracts amounts and reference numbers, translates to English, and proposes a supplier invoice entry. This is the most concrete ROI in the entire system.

---

## 1. User Story

As **Abhie or the Accountant**,
I want to **drop a supplier invoice PDF or image into the chat and have the AI extract the amounts, dates, and references — even if the document is in Arabic**,
so that **I don't have to manually read, translate, and key in supplier invoice data**.

---

## 2. Acceptance Criteria

### Input Handling
- [ ] AC1: User can attach a file to the chat (PDF, JPG, PNG, TIFF)
- [ ] AC2: Neutralino `os.showOpenDialog()` used for file selection (or drag-and-drop if Neutralino supports it)
- [ ] AC3: File is read as base64 via `Neutralino.filesystem.readFile()`

### OCR Processing
- [ ] AC4: English documents → direct Sarvam Vision analysis
- [ ] AC5: Arabic documents → Sarvam Vision extracts Arabic text, then Sarvam Translate to English
- [ ] AC6: Mixed Arabic/English (common in GCC) → handle both scripts in same document
- [ ] AC7: OCR confidence score is computed and shown (below 70% → flag as "needs review")

### Field Extraction
- [ ] AC8: Extract: invoice/reference number, date, supplier name, line items with amounts, subtotal, VAT %, VAT amount, total
- [ ] AC9: Amounts are extracted as strings, then converted to fils by the skill (not left as floats)
- [ ] AC10: Currency is detected (BHD / SAR / AED / USD) — non-BHD converted at stored exchange rate
- [ ] AC11: If required fields are missing → skill reports which fields need manual entry

### Approval Flow
- [ ] AC12: Skill is `approval: 'auto'` — OCR extraction does not require approval (it's analysis only, no writes)
- [ ] AC13: AFTER extraction, if the skill proposes creating a supplier invoice → that step requires explicit approval
- [ ] AC14: Extracted fields are shown in a structured card for Abhie to review before any write happens

### Integration with Supplier Invoice
- [ ] AC15: After extraction, AI offers: "Create supplier invoice from this document?" → this triggers `record_money_event` as an explicit/approval action
- [ ] AC16: Pre-filled form shows extracted fields; Abhie can correct any field before approving
- [ ] AC17: Original document reference (filename) stored in MoneyEvent.reference

---

## 3. Full-Stack Contract

### 3a. STDB Layer

No new schema changes. The skill produces structured data that feeds into `record_money_event` (which already exists).

Possible addition: `OcrDocument` table for storing OCR results (enabling "what did I OCR last week?"), but this is Wave 4+. For Wave 3, results are stored in AiAction.result.

### 3b. Skill Layer

```typescript
interface OcrDocumentArgs {
  filePath: string;           // absolute path on local filesystem
  language?: 'auto' | 'en' | 'ar' | 'mixed';   // default: 'auto'
  documentType?: 'invoice' | 'receipt' | 'statement' | 'po' | 'unknown'; // hint
}

interface OcrDocumentResult {
  rawText: string;              // full extracted text (for reference)
  translatedText?: string;      // English translation if Arabic
  language: string;             // detected language
  confidence: number;           // 0-1 OCR confidence
  extractedFields: {
    referenceNumber?: string;
    date?: string;              // ISO 8601 if parseable
    supplierName?: string;
    lineItems: Array<{
      description: string;
      quantity?: number;
      unitPrice?: string;       // raw string from document
      totalPrice?: string;      // raw string from document
    }>;
    subtotal?: string;          // raw string, e.g., "1,250.500"
    vatPercent?: number;        // e.g., 10
    vatAmount?: string;         // raw string
    total?: string;             // raw string
    currency?: string;          // "BHD", "SAR", "USD", etc.
  };
  missingFields: string[];      // fields that couldn't be extracted
  proposedSupplierInvoice?: {   // null if not enough data
    partyName: string;
    reference: string;
    totalFils: bigint;          // converted to fils
    dueDate?: string;
  };
}

const ocrDocumentSkill: Skill = {
  name: 'ocr_document',
  description: 'Extract text and structured fields from PDF/image documents — Arabic and English',
  category: 'file',
  approval: 'auto',             // OCR itself is read-only, no approval needed
  requiredRole: [UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Operations, UserRole.Accountant],
  execute: async (args: OcrDocumentArgs, ctx: SkillContext): Promise<OcrDocumentResult> => {
    // 1. Read file bytes
    const fileContent = await ctx.fs.readFile(args.filePath, 'base64');

    // 2. Detect file type from extension
    const ext = args.filePath.split('.').pop()?.toLowerCase();
    const mimeType = getMimeType(ext);  // 'application/pdf', 'image/jpeg', etc.

    // 3. Call Sarvam Vision (multilingual document understanding)
    const visionResponse = await ctx.ai.sarvam.vision({
      imageBase64: fileContent,
      mimeType,
      prompt: buildExtractionPrompt(args.documentType),
      language: args.language ?? 'auto',
    });

    // 4. Parse the structured JSON from vision response
    const extracted = parseVisionResponse(visionResponse);

    // 5. Translate if Arabic
    let translatedText: string | undefined;
    if (extracted.language === 'ar' || extracted.language === 'mixed') {
      translatedText = await ctx.ai.sarvam.translate({
        text: extracted.rawText,
        sourceLanguage: 'ar',
        targetLanguage: 'en',
      });
    }

    // 6. Convert amounts to fils
    const proposedInvoice = buildProposedInvoice(extracted);

    return {
      rawText: extracted.rawText,
      translatedText,
      language: extracted.language,
      confidence: extracted.confidence,
      extractedFields: extracted.fields,
      missingFields: findMissingFields(extracted.fields, args.documentType),
      proposedSupplierInvoice: proposedInvoice,
    };
  }
};
```

### 3c. Sarvam Vision Prompt

```typescript
function buildExtractionPrompt(documentType?: string): string {
  return `
You are analyzing a business document. Extract the following fields as JSON:
{
  "referenceNumber": "invoice or PO number",
  "date": "ISO 8601 date",
  "supplierName": "company that issued this document",
  "lineItems": [
    { "description": "item description", "quantity": 1, "unitPrice": "100.000", "total": "100.000" }
  ],
  "subtotal": "amount before VAT",
  "vatPercent": 10,
  "vatAmount": "VAT amount",
  "total": "grand total",
  "currency": "BHD/SAR/AED/USD",
  "language": "en/ar/mixed"
}

If a field is not present, use null. Do not infer or guess values.
Return ONLY the JSON, no explanation.
  `.trim();
}
```

### 3d. Amount Conversion (fils)

```typescript
function parseAmountToFils(amountStr: string, currency: string): bigint {
  // Clean the string: remove commas, currency symbols, whitespace
  const cleaned = amountStr.replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = parts[1]?.padEnd(3, '0').slice(0, 3) ?? '000';

  if (currency === 'BHD') {
    // BHD: 3 decimal places = 1 fil = 0.001 BHD
    return whole * 1000n + BigInt(frac);
  } else if (currency === 'SAR' || currency === 'AED') {
    // 2 decimal places — convert at stored exchange rate
    const rate = getExchangeRate(currency);  // from STDB config
    const fils = (whole * 100n + BigInt(frac.slice(0, 2))) * rate;
    return fils;
  }
  // USD: 2 decimal places, convert at rate
  const rate = getExchangeRate('USD');
  return (whole * 100n + BigInt(frac.slice(0, 2))) * rate;
}
```

### 3e. Client Layer

**Chat integration:**
```
User attaches a file →
- File picker opens (Neutralino.os.showOpenDialog)
- File path stored in chat state
- User types: "This is the invoice from Emerson" (context)
- AI recognizes file attachment + context → calls ocr_document skill
- OCR result renders as a structured ExtractedDocumentCard component
- Card shows: extracted fields, confidence, missing fields
- [Create Supplier Invoice] button → triggers explicit approval flow for record_money_event
```

**New component: `ExtractedDocumentCard.svelte`**

Shows:
- Supplier name, reference, date, total (in BHD format)
- Confidence score badge (green ≥70%, yellow 50-70%, red <50%)
- Missing fields list (if any)
- Raw text toggle (expandable)
- [Create Supplier Invoice] button (explicit approval, if enough data)
- [Download Translation] button (if Arabic → English translation exists)

---

## 4. Dependencies

- **Requires:** F014 (AiAction Approval Gate), F002 (Neutralino shell for file access), F003 (STDB wiring)
- **Blocks:** F022 (scan_folder uses same Neutralino file pattern), F025 (PPTX generation needs structured data extraction)

---

## 5. Invariants This Feature Must Respect

- INV-02: Extracted amounts must be converted to fils before any DB write — never store raw string amounts
- INV-07: Idempotency key required for supplier invoice create — SHA256(supplierName|total|date|reference)
- INV-12: Extraction result stored in AiAction.result for auditability
- INV-14: Vyapti — if the proposed supplier invoice reference already exists in STDB, warn before creating a duplicate

---

## 6. Architecture Notes

### Why Sarvam for Arabic (not Tesseract.js or AWS Textract)

1. **Arabic script OCR**: Tesseract.js has poor Arabic accuracy. Sarvam is built for GCC business documents.
2. **Already integrated**: Sarvam is the AI provider for the whole system. One API key, one provider.
3. **Translation included**: Sarvam Mayura (translation model) is the same provider — no second API.
4. **Cost**: Sarvam free tier is generous for the volume PH Trading processes.

### Why `approval: 'auto'` for OCR

OCR extraction reads a file and returns structured data — it doesn't write anything to STDB. This is analysis, not action. The approval gate comes at the "create supplier invoice" step, not the OCR step. Making OCR require approval would add friction to a zero-risk operation.

### Confidence threshold

Documents with confidence < 70% are flagged: "I'm not confident in this extraction — please review carefully." This is displayed prominently. Low confidence means more required fields show as missing, prompting Abhie to verify.

---

## 7. Test Plan

- [ ] English invoice PDF → correct fields extracted
- [ ] Arabic invoice image → Arabic text extracted + translated to English
- [ ] Mixed Arabic/English document → both scripts handled
- [ ] Confidence score rendered correctly (green/yellow/red badge)
- [ ] Missing field "total" → flagged in missingFields list
- [ ] BHD amounts correctly converted to fils (1,250.500 BHD = 1,250,500 fils)
- [ ] SAR amount → converted using exchange rate to BHD fils
- [ ] Duplicate invoice reference → warning shown before create
- [ ] [Create Supplier Invoice] → triggers explicit AiAction approval with pre-filled fields
- [ ] File larger than 10MB → graceful error message (Sarvam Vision limit)
- [ ] Non-existent file path → Neutralino error caught and shown to user

---

## 8. Session Log

| Date | Session | What Happened | Next Step |
|------|---------|---------------|-----------|
| 2026-03-20 | Spec | Created full contract — Arabic OCR is the core moat for this feature | Build after F014 and F022 are live |
