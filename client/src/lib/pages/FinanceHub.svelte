<script lang="ts">
  // FinanceHub.svelte — V4 Rams × Neumorphic
  // Invoices | Payments | AR Aging

  import { parties, moneyEvents, lineItems, bankTransactions as stdbBankTransactions, getConnection } from '../db';
  import { currentRole, toast } from '../stores';
  import { formatBHD, formatDate } from '../format';
  import { Timestamp } from 'spacetimedb';
  import { get } from 'svelte/store';
  import CreateInvoiceModal from '../components/CreateInvoiceModal.svelte';
  import RecordPaymentModal from '../components/RecordPaymentModal.svelte';
  import { generateInvoicePdf } from '../documents/invoiceGenerator';
  import { generateStatementPdf } from '../documents/statementGenerator';
  import { computeARAgingRows, computeARAgingTotals } from '../business/arAging';
  import { buildPaymentCandidates, parseBankStatementCsv, suggestMatches } from '../business/bankReconciliation';
  import { executeTallyImport, prepareTallyImportPreview, type TallyImportExecutionResult, type TallyImportMode, type TallyImportPreview } from '../business/tallyImport';
  import { loadChequeRegister, computeChequeSummary, findByStatus, type ChequeRegister as ChequeRegisterType, type ChequeEntry } from '../business/chequeRegister';
  import { enter } from '$lib/motion/asymm-motion';
  import { executeSkill } from '../skills/executor';

  let showCreateInvoice = $state(false);
  let showRecordPayment = $state(false);
  let activeTab = $state('invoices');
  let searchQuery = $state('');
  let statusFilter = $state('all');
  let selectedStatementPartyId = $state<bigint | null>(null);
  let bankSearchQuery = $state('');
  let bankStatusFilter = $state('Unmatched');
  let bankImportBankName = $state('NBB');
  let importingBankStatement = $state(false);
  let selectedBankTransactionId = $state<bigint | null>(null);
  let selectedCandidateId = $state<bigint | null>(null);
  let bankActionInFlight = $state(false);
  let bankImportInput: HTMLInputElement | null = null;
  let exportingAging = $state(false);
  let tallyImportMode = $state<TallyImportMode>('customer_invoices');
  let tallyImportInput: HTMLInputElement | null = null;
  let tallyParsing = $state(false);
  let tallyImporting = $state(false);
  let tallyPreview = $state<TallyImportPreview | null>(null);
  let tallyLastResult = $state<TallyImportExecutionResult | null>(null);

  let chequeRegister = $state<ChequeRegisterType>(loadChequeRegister());
  let chequeSummary = $derived(computeChequeSummary(chequeRegister));
  let chequeFilter = $state<string>('all');

  let displayCheques = $derived.by(() => {
    if (chequeFilter === 'all') return chequeRegister.entries;
    return findByStatus(chequeRegister, chequeFilter as any);
  });

  const DEMO_CHEQUES: ChequeEntry[] = [];
  let showCheques = $derived(chequeRegister.entries.length > 0 ? displayCheques : [
    { id: 'CHQ-20260315-0001', chequeNumber: '001234', bankName: 'NBB', payeeName: 'Endress+Hauser', amountFils: 12500000n, issueDate: '2026-03-15', status: 'issued' as const, reference: 'PO-2026-008', statusHistory: [], createdAt: '2026-03-15', updatedAt: '2026-03-15' },
    { id: 'CHQ-20260310-0002', chequeNumber: '001235', bankName: 'NBB', payeeName: 'Servomex', amountFils: 4200000n, issueDate: '2026-03-10', clearingDate: '2026-03-18', status: 'cleared' as const, reference: 'PO-2026-005', statusHistory: [], createdAt: '2026-03-10', updatedAt: '2026-03-18' },
    { id: 'CHQ-20260301-0003', chequeNumber: '001236', bankName: 'BBK', payeeName: 'GIC India', amountFils: 1800000n, issueDate: '2026-03-01', status: 'presented' as const, reference: 'PO-2026-003', statusHistory: [], createdAt: '2026-03-01', updatedAt: '2026-03-05' },
  ]);

  const tabs = [
    { id: 'invoices', label: 'Invoices' },
    { id: 'payments', label: 'Payments' },
    { id: 'bank', label: 'Bank Recon' },
    { id: 'tally', label: 'Tally Import' },
    { id: 'aging', label: 'AR Aging' },
    { id: 'cheques', label: 'Cheques' },
  ];

  // ── Demo data (shown when live data is empty) ──────────────

  type DemoInvoice = {
    id: bigint;
    ref: string;
    customer: string;
    grade: string;
    total: string;
    status: string;
    dueDate: string;
    overdueDays: number | null;
    outstandingFils: bigint;
    outstanding: string;
    subtotal: string;
    vat: string;
    reference: string;
  };

  const DEMO_INVOICES: DemoInvoice[] = [
    { id: 1n, ref: 'INV-2025-001', customer: 'EWA', grade: 'A', subtotal: '14,545.455', vat: '1,454.545', total: '16,000.000', outstanding: '16,000.000', outstandingFils: 16000000n, status: 'Overdue', dueDate: '2025-08-15', overdueDays: 214, reference: 'EWA-PO-2025-0331' },
    { id: 2n, ref: 'INV-2025-002', customer: 'EWA', grade: 'A', subtotal: '9,090.909', vat: '909.091', total: '10,000.000', outstanding: '0.000', outstandingFils: 0n, status: 'Paid', dueDate: '2025-09-01', overdueDays: null, reference: 'EWA-PO-2025-0412' },
    { id: 3n, ref: 'INV-2025-003', customer: 'BAPCO', grade: 'B', subtotal: '7,272.727', vat: '727.273', total: '8,000.000', outstanding: '8,000.000', outstandingFils: 8000000n, status: 'Overdue', dueDate: '2025-07-20', overdueDays: 240, reference: 'BAPCO-RFQ-441' },
    { id: 4n, ref: 'INV-2025-004', customer: 'ALBA', grade: 'A', subtotal: '5,454.545', vat: '545.455', total: '6,000.000', outstanding: '6,000.000', outstandingFils: 6000000n, status: 'Overdue', dueDate: '2025-09-10', overdueDays: 188, reference: 'ALBA-2025-WO-888' },
    { id: 5n, ref: 'INV-2025-005', customer: 'Al Ezzel', grade: 'C', subtotal: '3,636.364', vat: '363.636', total: '4,000.000', outstanding: '4,000.000', outstandingFils: 4000000n, status: 'Overdue', dueDate: '2025-09-25', overdueDays: 173, reference: 'EZZEL-2025-112' },
    { id: 6n, ref: 'INV-2025-006', customer: 'GPIC', grade: 'B', subtotal: '2,727.273', vat: '272.727', total: '3,000.000', outstanding: '0.000', outstandingFils: 0n, status: 'Paid', dueDate: '2025-10-05', overdueDays: null, reference: 'GPIC-PO-2025-0601' },
    { id: 7n, ref: 'INV-2025-007', customer: 'EWA', grade: 'A', subtotal: '18,181.818', vat: '1,818.182', total: '20,000.000', outstanding: '0.000', outstandingFils: 0n, status: 'Paid', dueDate: '2025-10-20', overdueDays: null, reference: 'EWA-PO-2025-0498' },
    { id: 8n, ref: 'INV-2025-008', customer: 'Tatweer', grade: 'B', subtotal: '1,818.182', vat: '181.818', total: '2,000.000', outstanding: '2,000.000', outstandingFils: 2000000n, status: 'Overdue', dueDate: '2025-10-30', overdueDays: 138, reference: 'TAT-2025-PO-099' },
    { id: 9n, ref: 'INV-2025-009', customer: 'NOGA', grade: 'B', subtotal: '4,545.455', vat: '454.545', total: '5,000.000', outstanding: '5,000.000', outstandingFils: 5000000n, status: 'Sent', dueDate: '2025-12-15', overdueDays: null, reference: 'NOGA-2025-REQ-77' },
    { id: 10n, ref: 'INV-2025-010', customer: 'SULB', grade: 'C', subtotal: '2,272.727', vat: '227.273', total: '2,500.000', outstanding: '2,500.000', outstandingFils: 2500000n, status: 'Sent', dueDate: '2025-12-20', overdueDays: null, reference: 'SULB-PO-2025-056' },
    { id: 11n, ref: 'INV-2025-011', customer: 'TTSJV', grade: 'B', subtotal: '3,181.818', vat: '318.182', total: '3,500.000', outstanding: '3,500.000', outstandingFils: 3500000n, status: 'Draft', dueDate: '—', overdueDays: null, reference: 'TTSJV-2025-WO-031' },
    { id: 12n, ref: 'INV-2025-012', customer: 'EWA', grade: 'A', subtotal: '12,727.273', vat: '1,272.727', total: '14,000.000', outstanding: '14,000.000', outstandingFils: 14000000n, status: 'Sent', dueDate: '2026-01-10', overdueDays: null, reference: 'EWA-PO-2025-0607' },
    { id: 13n, ref: 'INV-2025-013', customer: 'Arla', grade: 'A', subtotal: '8,181.818', vat: '818.182', total: '9,000.000', outstanding: '0.000', outstandingFils: 0n, status: 'Paid', dueDate: '2025-11-28', overdueDays: null, reference: 'ARLA-PO-2025-321' },
    { id: 14n, ref: 'INV-2025-014', customer: 'BAPCO', grade: 'B', subtotal: '6,363.636', vat: '636.364', total: '7,000.000', outstanding: '7,000.000', outstandingFils: 7000000n, status: 'Overdue', dueDate: '2025-08-01', overdueDays: 228, reference: 'BAPCO-RFQ-489' },
    { id: 15n, ref: 'INV-2025-015', customer: 'Al Ezzel', grade: 'C', subtotal: '1,363.636', vat: '136.364', total: '1,500.000', outstanding: '1,500.000', outstandingFils: 1500000n, status: 'Overdue', dueDate: '2025-09-12', overdueDays: 186, reference: 'EZZEL-2025-119' },
  ];

  const DEMO_PAYMENTS = [
    { id: 1n, ref: 'PAY-2025-001', customer: 'EWA', amount: '10,000.000', amountFils: 10000000n, invoiceRef: 'INV-2025-002', method: 'Bank Transfer', date: '2025-08-28' },
    { id: 2n, ref: 'PAY-2025-002', customer: 'GPIC', amount: '3,000.000', amountFils: 3000000n, invoiceRef: 'INV-2025-006', method: 'Bank Transfer', date: '2025-10-02' },
    { id: 3n, ref: 'PAY-2025-003', customer: 'EWA', amount: '20,000.000', amountFils: 20000000n, invoiceRef: 'INV-2025-007', method: 'Bank Transfer', date: '2025-10-18' },
    { id: 4n, ref: 'PAY-2025-004', customer: 'Arla', amount: '9,000.000', amountFils: 9000000n, invoiceRef: 'INV-2025-013', method: 'Cheque', date: '2025-11-25' },
    { id: 5n, ref: 'PAY-2025-005', customer: 'EWA', amount: '6,000.000', amountFils: 6000000n, invoiceRef: 'INV-2025-001 (partial)', method: 'Bank Transfer', date: '2025-12-10' },
  ];

  const DEMO_AGING = [
    { name: 'EWA', grade: 'A', current: 14000000n, d30: 0n, d60: 0n, d90: 0n, d90plus: 16000000n, total: 30000000n },
    { name: 'BAPCO', grade: 'B', current: 0n, d30: 0n, d60: 0n, d90: 0n, d90plus: 15000000n, total: 15000000n },
    { name: 'ALBA', grade: 'A', current: 0n, d30: 0n, d60: 0n, d90: 6000000n, d90plus: 0n, total: 6000000n },
    { name: 'Al Ezzel', grade: 'C', current: 0n, d30: 0n, d60: 0n, d90: 0n, d90plus: 5500000n, total: 5500000n },
    { name: 'NOGA', grade: 'B', current: 5000000n, d30: 0n, d60: 0n, d90: 0n, d90plus: 0n, total: 5000000n },
    { name: 'SULB', grade: 'C', current: 2500000n, d30: 0n, d60: 0n, d90: 0n, d90plus: 0n, total: 2500000n },
    { name: 'TTSJV', grade: 'B', current: 3500000n, d30: 0n, d60: 0n, d90: 0n, d90plus: 0n, total: 3500000n },
    { name: 'Tatweer', grade: 'B', current: 0n, d30: 0n, d60: 2000000n, d90: 0n, d90plus: 0n, total: 2000000n },
  ];

  // ── Party lookup map ──────────────────────────────────

  let partyMap = $derived(new Map($parties.map((p) => [p.id, p])));

  // ── Invoice rows ──────────────────────────────────────

  let invoiceRows = $derived.by(() => {
    const now = BigInt(Date.now()) * 1000n;
    return $moneyEvents
      .filter((ev) => (ev.kind as any)?.tag === 'CustomerInvoice')
      .map((ev) => {
        const party = partyMap.get(ev.partyId);
        const grade = (party?.grade as any)?.tag ?? '?';
        const status = (ev.status as any)?.tag ?? 'Draft';
        const isPaid = status === 'Terminal' || !!ev.paidAt;
        let displayStatus = status;
        if (isPaid) displayStatus = 'Paid';
        else if (ev.dueDate && ev.dueDate.microsSinceUnixEpoch < now && !ev.paidAt) displayStatus = 'Overdue';
        else if (status === 'Active') displayStatus = 'Sent';
        let overdueDays: number | null = null;
        if (displayStatus === 'Overdue' && ev.dueDate) {
          const diffMs = Number((now - ev.dueDate.microsSinceUnixEpoch) / 1000n);
          overdueDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }
        return {
          id: ev.id,
          ref: `INV-${String(ev.id).padStart(3, '0')}`,
          customer: party?.name ?? '—',
          grade,
          subtotal: formatBHD(ev.subtotalFils),
          vat: formatBHD(ev.vatFils),
          total: formatBHD(ev.totalFils),
          outstanding: isPaid ? formatBHD(0n) : formatBHD(ev.totalFils),
          outstandingFils: isPaid ? 0n : ev.totalFils,
          status: displayStatus,
          dueDate: ev.dueDate ? formatDate(ev.dueDate) : '—',
          overdueDays,
          reference: ev.reference,
        };
      })
      .sort((a, b) => Number(b.id - a.id));
  });

  // ── Payment rows ──────────────────────────────────────

  let paymentRows = $derived(
    $moneyEvents
      .filter((ev) => (ev.kind as any)?.tag === 'CustomerPayment')
      .map((ev) => {
        const party = partyMap.get(ev.partyId);
        return {
          id: ev.id,
          customer: party?.name ?? '—',
          amount: formatBHD(ev.totalFils),
          amountFils: ev.totalFils,
          reference: ev.reference,
          receivedDate: formatDate(ev.createdAt),
          method: 'Bank Transfer',
        };
      })
      .sort((a, b) => Number(b.id - a.id))
  );

  // ── Derived totals ────────────────────────────────────

  let totalInvoiced = $derived(invoiceRows.reduce((s, r) => s + (r.outstandingFils > 0n ? r.outstandingFils : 0n) + (r.status === 'Paid' ? 1n : 0n), 0n));
  let totalOutstanding = $derived(invoiceRows.reduce((s, r) => s + r.outstandingFils, 0n));
  let totalReceived = $derived(paymentRows.reduce((s, r) => s + r.amountFils, 0n));
  let overdueAmount = $derived(
    invoiceRows.filter((r) => r.status === 'Overdue').reduce((s, r) => s + r.outstandingFils, 0n)
  );

  // Demo totals (when no live data)
  const DEMO_OUTSTANDING = DEMO_INVOICES.filter(i => i.status !== 'Paid' && i.status !== 'Draft')
    .reduce((s, i) => s + i.outstandingFils, 0n);
  const DEMO_INVOICED_TOTAL = DEMO_INVOICES.reduce((s, i) => s + BigInt(Math.round(parseFloat(i.total.replace(/,/g,'')) * 1000)), 0n);
  const DEMO_RECEIVED = DEMO_PAYMENTS.reduce((s, p) => s + p.amountFils, 0n);

  const useLiveData = $derived(invoiceRows.length > 0 || paymentRows.length > 0);

  // ── Summary stats (live or demo) ─────────────────────

  let displayInvoiced = $derived(useLiveData ? totalInvoiced : DEMO_INVOICED_TOTAL);
  let displayReceived = $derived(useLiveData ? totalReceived : DEMO_RECEIVED);
  let displayOutstanding = $derived(useLiveData ? totalOutstanding : DEMO_OUTSTANDING);

  let collectionRate = $derived.by(() => {
    const inv = Number(displayInvoiced) / 1000;
    const rec = Number(displayReceived) / 1000;
    if (inv === 0) return 0;
    return Math.round((rec / inv) * 100);
  });

  // ── AR Aging (live) ───────────────────────────────────

  let agingRows = $derived.by(() =>
    computeARAgingRows($parties, $moneyEvents, BigInt(Date.now()) * 1000n)
  );
  let agingTotals = $derived.by(() => computeARAgingTotals(agingRows));

  // ── Filtered invoices ─────────────────────────────────

  let filteredInvoices = $derived.by(() => {
    const source = useLiveData ? invoiceRows : DEMO_INVOICES;
    const q = searchQuery.trim().toLowerCase();
    return source.filter((r: any) => {
      if (q && !r.customer.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && r.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      return true;
    });
  });

  let displayPayments = $derived(useLiveData ? paymentRows : DEMO_PAYMENTS);

  let reconciliationEventRows = $derived.by(() =>
    $moneyEvents
      .filter((ev) =>
        ((ev.kind as any)?.tag === 'CustomerPayment' || (ev.kind as any)?.tag === 'SupplierPayment') &&
        (ev.status as any)?.tag !== 'Draft' &&
        (ev.status as any)?.tag !== 'Cancelled'
      )
      .map((ev) => {
        const party = partyMap.get(ev.partyId);
        const kind = (ev.kind as any)?.tag ?? 'Payment';
        return {
          moneyEventId: ev.id,
          partyName: party?.name ?? '—',
          kind,
          reference: ev.reference,
          amountFils: ev.totalFils,
          signedAmountFils: kind === 'SupplierPayment' ? -ev.totalFils : ev.totalFils,
          createdAtMicros: ev.createdAt.microsSinceUnixEpoch,
          createdAtLabel: formatDate(ev.createdAt),
        };
      })
      .sort((a, b) => Number(b.createdAtMicros - a.createdAtMicros))
  );

  let reconciliationEventMap = $derived.by(
    () => new Map(reconciliationEventRows.map((row) => [row.moneyEventId, row]))
  );

  let paymentCandidates = $derived.by(() =>
    buildPaymentCandidates({
      parties: $parties,
      moneyEvents: $moneyEvents,
      bankTransactions: $stdbBankTransactions,
    })
  );

  let paymentCandidateMap = $derived.by(
    () => new Map(paymentCandidates.map((candidate) => [candidate.moneyEventId, candidate]))
  );

  let bankTransactionsSorted = $derived.by(() =>
    [...$stdbBankTransactions].sort((left, right) => {
      const dateDiff = right.transactionDate.microsSinceUnixEpoch - left.transactionDate.microsSinceUnixEpoch;
      if (dateDiff !== 0n) return Number(dateDiff);
      return Number(right.id - left.id);
    })
  );

  let bankReconCounts = $derived.by(() =>
    bankTransactionsSorted.reduce(
      (summary, transaction) => {
        const status = (transaction.matchStatus as any)?.tag ?? 'Unmatched';
        if (status === 'Matched') summary.matched += 1;
        else if (status === 'Disputed') summary.disputed += 1;
        else summary.unmatched += 1;
        return summary;
      },
      { matched: 0, unmatched: 0, disputed: 0 }
    )
  );

  let filteredBankTransactions = $derived.by(() => {
    const query = bankSearchQuery.trim().toLowerCase();
    return bankTransactionsSorted.filter((transaction) => {
      const status = (transaction.matchStatus as any)?.tag ?? 'Unmatched';
      if (bankStatusFilter !== 'All' && status !== bankStatusFilter) return false;
      if (!query) return true;
      return (
        transaction.description.toLowerCase().includes(query) ||
        transaction.reference.toLowerCase().includes(query) ||
        transaction.bankName.toLowerCase().includes(query)
      );
    });
  });

  let selectedBankTransaction = $derived.by(
    () => bankTransactionsSorted.find((transaction) => transaction.id === selectedBankTransactionId) ?? null
  );

  let selectedBankSuggestions = $derived.by(() => {
    if (!selectedBankTransaction) return [];
    return suggestMatches(selectedBankTransaction, paymentCandidates);
  });

  let suggestionScoreMap = $derived.by(
    () => new Map(selectedBankSuggestions.map((suggestion) => [suggestion.moneyEventId, suggestion.score]))
  );

  let displayedPaymentCandidates = $derived.by(() =>
    [...paymentCandidates].sort((left, right) => {
      const leftScore = suggestionScoreMap.get(left.moneyEventId) ?? 0;
      const rightScore = suggestionScoreMap.get(right.moneyEventId) ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return Number(right.createdAtMicros - left.createdAtMicros);
    })
  );

  let matchedBankTransactions = $derived.by(() =>
    bankTransactionsSorted.filter((transaction) => ((transaction.matchStatus as any)?.tag ?? 'Unmatched') !== 'Unmatched')
  );

  // ── MTD received (current month) ─────────────────────

  let mtdReceived = $derived.by(() => {
    if (useLiveData) return totalReceived;
    // Demo: just show total received as MTD
    return DEMO_RECEIVED;
  });

  // ── Statement generation ──────────────────────────────

  let invoiceCustomers = $derived.by(() => {
    const seen = new Map<bigint, { id: bigint; name: string }>();
    for (const ev of $moneyEvents) {
      if ((ev.kind as any)?.tag !== 'CustomerInvoice') continue;
      if (seen.has(ev.partyId)) continue;
      const p = partyMap.get(ev.partyId);
      if (p) seen.set(ev.partyId, { id: ev.partyId, name: p.name });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  const statusColor: Record<string, string> = {
    Draft: 'muted',
    Sent: 'amber',
    Active: 'amber',
    Overdue: 'coral',
    Paid: 'sage',
    Terminal: 'sage',
    Cancelled: 'muted',
  };

  const gradeColor: Record<string, string> = {
    A: 'sage',
    B: 'blue',
    C: 'amber',
    D: 'coral',
  };

  let generatingPdfId = $state<bigint | null>(null);

  async function handleDownloadPdf(rowId: bigint) {
    if (generatingPdfId) return;
    generatingPdfId = rowId;
    try {
      const invoice = $moneyEvents.find(ev => ev.id === rowId);
      if (!invoice) return;
      const party = partyMap.get(invoice.partyId);
      if (!party) return;
      const items = $lineItems.filter(li => li.parentType === 'invoice' && li.parentId === rowId);
      await generateInvoicePdf({ invoice, party, lineItems: items });
    } finally {
      generatingPdfId = null;
    }
  }

  function handleGenerateStatement() {
    if (!selectedStatementPartyId) return;
    const party = partyMap.get(selectedStatementPartyId);
    if (!party) return;
    const partyEvents = $moneyEvents.filter(ev => ev.partyId === selectedStatementPartyId);
    generateStatementPdf({ party, moneyEvents: partyEvents });
  }

  async function handleExportARAging() {
    if (exportingAging) return;

    exportingAging = true;
    try {
      const result = await executeSkill(
        'export_to_excel',
        { dataSource: 'AR Aging' },
        {
          userRole: $currentRole ?? '',
          approved: true,
        }
      );

      if (result.success) {
        toast.success(result.summary);
      } else {
        toast.danger(result.summary);
      }
    } finally {
      exportingAging = false;
    }
  }

  // ── Aging bar helpers ─────────────────────────────────

  function tallyModeLabel(mode: TallyImportMode): string {
    if (mode === 'customer_invoices') return 'Customer Invoices';
    if (mode === 'supplier_invoices') return 'Supplier Invoices';
    if (mode === 'customer_payments') return 'Customer Payments';
    if (mode === 'ar_defaulters') return 'AR Defaulters';
    return 'Supplier Payments';
  }

  function resetTallyInput() {
    if (tallyImportInput) tallyImportInput.value = '';
  }

  function triggerTallyImportPicker() {
    tallyImportInput?.click();
  }

  async function handleTallyFileSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    tallyParsing = true;
    tallyLastResult = null;
    try {
      const workbookData = await file.arrayBuffer();
      tallyPreview = prepareTallyImportPreview(
        workbookData,
        tallyImportMode,
        $parties,
        $moneyEvents,
        file.name,
      );
      toast.success(
        `Preview ready for ${tallyModeLabel(tallyImportMode)}: ` +
        `${tallyPreview.readyRows} ready, ${tallyPreview.duplicateRows} duplicates, ${tallyPreview.invalidRows} invalid.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tallyPreview = null;
      toast.danger(`Could not parse Tally workbook: ${message}`);
    } finally {
      tallyParsing = false;
      resetTallyInput();
    }
  }

  async function handleExecuteTallyImport() {
    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    if (!tallyPreview) {
      toast.warning('Choose a Tally workbook first.');
      return;
    }

    tallyImporting = true;
    try {
      const result = await executeTallyImport(
        tallyPreview,
        conn,
        () => get(parties),
        () => get(moneyEvents),
      );

      tallyLastResult = result;
      if (result.errors > 0) {
        toast.warning(
          `Tally import finished: ${result.imported} imported, ${result.duplicates} duplicates, ${result.errors} errors.`
        );
      } else {
        toast.success(
          `Tally import finished: ${result.imported} imported, ${result.duplicates} duplicates, ${result.createdParties} new parties created.`
        );
      }
    } finally {
      tallyImporting = false;
    }
  }

  function agingBarSegments(row: typeof DEMO_AGING[0]) {
    const total = Number(row.total) || 1;
    return [
      { label: 'Current', fils: row.current, pct: (Number(row.current) / total * 100).toFixed(1), color: 'sage' },
      { label: '30d', fils: row.d30, pct: (Number(row.d30) / total * 100).toFixed(1), color: 'amber' },
      { label: '60d', fils: row.d60, pct: (Number(row.d60) / total * 100).toFixed(1), color: 'gold' },
      { label: '90d', fils: row.d90, pct: (Number(row.d90) / total * 100).toFixed(1), color: 'coral-light' },
      { label: '90d+', fils: row.d90plus, pct: (Number(row.d90plus) / total * 100).toFixed(1), color: 'coral' },
    ].filter(s => s.fils > 0n);
  }

  function fmtBHDRaw(fils: bigint): string {
    const n = Number(fils) / 1000;
    return n.toLocaleString('en-BH', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function agingMaxTotal(): number {
    const source = useLiveData ? agingRows.map(r => r.outstandingFils) : DEMO_AGING.map(r => r.total);
    return Math.max(...source.map(v => Number(v)), 1);
  }

  function resetBankImportInput() {
    if (bankImportInput) bankImportInput.value = '';
  }

  function triggerBankImportPicker() {
    bankImportInput?.click();
  }

  function formatMatchStatus(status: string): string {
    if (status === 'Matched') return 'sage';
    if (status === 'Disputed') return 'coral';
    return 'amber';
  }

  async function handleBankImportSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      resetBankImportInput();
      return;
    }

    importingBankStatement = true;
    try {
      const csvText = await file.text();
      const rows = parseBankStatementCsv(csvText, bankImportBankName.trim() || 'Bank');
      for (const row of rows) {
        await conn.reducers.importBankTransaction({
          bankName: row.bankName,
          transactionDate: Timestamp.fromDate(row.transactionDate),
          description: row.description,
          amountFils: row.amountFils,
          reference: row.reference,
        });
      }
      toast.success(`Imported ${rows.length} bank transaction${rows.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not import bank statement: ${message}`);
    } finally {
      importingBankStatement = false;
      resetBankImportInput();
    }
  }

  async function handleMatchBankTransaction(moneyEventId: bigint) {
    if (!selectedBankTransaction) {
      toast.warning('Choose a bank transaction first.');
      return;
    }

    const candidate = paymentCandidateMap.get(moneyEventId);
    if (!candidate) {
      toast.warning('That payment is no longer available for matching.');
      return;
    }

    if (candidate.signedAmountFils !== selectedBankTransaction.amountFils) {
      toast.danger('Amount mismatch: bank transaction and payment must match exactly before reconciliation.');
      return;
    }

    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    bankActionInFlight = true;
    try {
      await conn.reducers.matchBankTransaction({
        bankTransactionId: selectedBankTransaction.id,
        moneyEventId,
      });
      toast.success(`Matched bank transaction to ${candidate.partyName}.`);
      selectedCandidateId = null;
      selectedBankTransactionId = null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not match bank transaction: ${message}`);
    } finally {
      bankActionInFlight = false;
    }
  }

  async function handleDisputeSelectedBankTransaction() {
    if (!selectedBankTransaction) return;
    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    bankActionInFlight = true;
    try {
      await conn.reducers.disputeBankTransaction({ bankTransactionId: selectedBankTransaction.id });
      toast.info(`Bank transaction #${selectedBankTransaction.id} marked disputed.`);
      selectedBankTransactionId = null;
      selectedCandidateId = null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not dispute bank transaction: ${message}`);
    } finally {
      bankActionInFlight = false;
    }
  }

  async function handleUnmatchBankTransaction(transactionId: bigint) {
    const conn = getConnection();
    if (!conn) {
      toast.danger('Not connected to the database.');
      return;
    }

    bankActionInFlight = true;
    try {
      await conn.reducers.unmatchBankTransaction({ bankTransactionId: transactionId });
      toast.info(`Bank transaction #${transactionId} returned to unmatched.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.danger(`Could not unmatch bank transaction: ${message}`);
    } finally {
      bankActionInFlight = false;
    }
  }

  $effect(() => {
    if (!selectedBankTransaction) {
      selectedCandidateId = null;
      return;
    }

    const transactionStillVisible = bankTransactionsSorted.some((transaction) => transaction.id === selectedBankTransaction.id);
    if (!transactionStillVisible) {
      selectedBankTransactionId = null;
      selectedCandidateId = null;
      return;
    }

    if (selectedCandidateId && paymentCandidateMap.has(selectedCandidateId)) {
      return;
    }

    const topSuggestion = selectedBankSuggestions[0];
    selectedCandidateId = topSuggestion?.moneyEventId ?? paymentCandidates[0]?.moneyEventId ?? null;
  });
</script>

<div class="hub-page">

  <!-- Header -->
  <header class="hub-header" use:enter={{ index: 0 }}>
    <div class="hub-title-group">
      <h1 class="hub-title">FINANCE</h1>
    </div>

    <!-- KPI strip -->
    <div class="kpi-strip">
      <div class="kpi-card card">
        <span class="kpi-label">Total Invoiced</span>
        <span class="kpi-value">{fmtBHDRaw(displayInvoiced)}</span>
        <span class="kpi-unit">BHD</span>
      </div>
      <div class="kpi-card card">
        <span class="kpi-label">Total Received</span>
        <span class="kpi-value kpi-sage">{fmtBHDRaw(displayReceived)}</span>
        <span class="kpi-unit">BHD</span>
      </div>
      <div class="kpi-card card" class:card-danger={displayOutstanding > 0n}>
        <span class="kpi-label">Outstanding</span>
        <span class="kpi-value kpi-coral">{fmtBHDRaw(displayOutstanding)}</span>
        <span class="kpi-unit">BHD</span>
      </div>
      <div class="kpi-card card">
        <span class="kpi-label">Collection Rate</span>
        <span class="kpi-value" class:kpi-sage={collectionRate >= 80} class:kpi-amber={collectionRate >= 50 && collectionRate < 80} class:kpi-coral={collectionRate < 50}>{collectionRate}%</span>
        <span class="kpi-unit">of invoiced</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="hub-actions">
      {#if activeTab === 'aging'}
        <button class="btn btn-sm" onclick={handleExportARAging} disabled={exportingAging}>
          {exportingAging ? 'Exporting...' : 'Export Aging'}
        </button>
      {/if}
      <button class="btn btn-gold btn-sm" onclick={() => (showCreateInvoice = true)}>+ Invoice</button>
      <button class="btn btn-sm" onclick={() => (showRecordPayment = true)}>+ Payment</button>
    </div>
  </header>

  <!-- Tabs -->
  <div class="tabs-row" use:enter={{ index: 1 }}>
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="tab-content" use:enter={{ index: 2 }}>

    <!-- INVOICES TAB -->
    {#if activeTab === 'invoices'}
      <div class="filter-bar">
        <input
          class="search-neu"
          type="search"
          placeholder="Search by customer..."
          bind:value={searchQuery}
          aria-label="Search invoices"
        />
        <select class="select-neu" bind:value={statusFilter} aria-label="Filter by status">
          <option value="all">All Statuses</option>
          <option value="overdue">Overdue</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="draft">Draft</option>
        </select>
        {#if (filteredInvoices as any[]).length !== (useLiveData ? invoiceRows : DEMO_INVOICES).length}
          <span class="filter-count">{(filteredInvoices as any[]).length} of {(useLiveData ? invoiceRows : DEMO_INVOICES).length}</span>
        {/if}
      </div>

      {#if (filteredInvoices as any[]).length === 0}
        <div class="empty-state">
          <div class="empty-glyph">&#9675;</div>
          <p class="empty-msg">No invoices match your filter.</p>
        </div>
      {:else}
        <div class="table-shell card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th class="num-col">Amount (BHD)</th>
                <th>Status</th>
                <th>Due Date</th>
                <th class="num-col">Days Over</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each filteredInvoices as row}
                <tr class="table-row" class:row-overdue={(row as any).status === 'Overdue'}>
                  <td class="cell-ref">{(row as any).ref}</td>
                  <td>
                    <div class="customer-cell">
                      <span class="grade-dot grade-{gradeColor[(row as any).grade] ?? 'neutral'}">{(row as any).grade}</span>
                      <span class="cell-name">{(row as any).customer}</span>
                    </div>
                  </td>
                  <td class="num-col">
                    <span class="cell-amount">{(row as any).total}</span>
                    {#if (row as any).outstandingFils > 0n && (row as any).status !== 'Draft'}
                      <span class="amount-sub cell-outstanding">{(row as any).outstanding} due</span>
                    {/if}
                  </td>
                  <td>
                    <span class="badge badge-{statusColor[(row as any).status] ?? 'muted'}">{(row as any).status}</span>
                  </td>
                  <td class="cell-date" class:date-overdue={(row as any).status === 'Overdue'}>{(row as any).dueDate}</td>
                  <td class="num-col">
                    {#if (row as any).overdueDays}
                      <span class="days-over">{(row as any).overdueDays}d</span>
                    {:else}
                      <span class="cell-muted">—</span>
                    {/if}
                  </td>
                  <td>
                    {#if useLiveData}
                      <button
                        class="pdf-btn"
                        disabled={generatingPdfId === (row as any).id}
                        onclick={() => handleDownloadPdf((row as any).id)}
                        title="Download PDF"
                      >
                        {generatingPdfId === (row as any).id ? '...' : 'PDF'}
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- PAYMENTS TAB -->
    {:else if activeTab === 'payments'}
      <div class="mtd-banner card-subtle">
        <span class="mtd-label">Total Received MTD</span>
        <span class="mtd-value">{fmtBHDRaw(mtdReceived)} BHD</span>
      </div>

      {#if (displayPayments as any[]).length === 0}
        <div class="empty-state">
          <div class="empty-glyph">&#9675;</div>
          <p class="empty-msg">No payments recorded yet.</p>
        </div>
      {:else}
        <div class="table-shell card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
                <th class="num-col">Amount (BHD)</th>
                <th>Date</th>
                <th>Invoice</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {#each displayPayments as row}
                <tr class="table-row">
                  <td class="cell-ref">{(row as any).ref ?? (row as any).reference}</td>
                  <td><span class="cell-name">{(row as any).customer}</span></td>
                  <td class="num-col">
                    <span class="cell-amount cell-amount-received">{(row as any).amount}</span>
                  </td>
                  <td class="cell-date">{(row as any).date ?? (row as any).receivedDate}</td>
                  <td class="cell-muted cell-sm">{(row as any).invoiceRef ?? '—'}</td>
                  <td>
                    <span class="method-chip">{(row as any).method}</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

    <!-- BANK RECON TAB -->
    {:else if activeTab === 'bank'}
      <div class="bank-summary-grid">
        <div class="bank-summary-card card-subtle">
          <span class="bank-summary-label">Unmatched</span>
          <span class="bank-summary-value kpi-amber">{bankReconCounts.unmatched}</span>
        </div>
        <div class="bank-summary-card card-subtle">
          <span class="bank-summary-label">Matched</span>
          <span class="bank-summary-value kpi-sage">{bankReconCounts.matched}</span>
        </div>
        <div class="bank-summary-card card-subtle">
          <span class="bank-summary-label">Disputed</span>
          <span class="bank-summary-value kpi-coral">{bankReconCounts.disputed}</span>
        </div>
        <div class="bank-summary-card card">
          <span class="bank-summary-label">Open Payment Candidates</span>
          <span class="bank-summary-value">{paymentCandidates.length}</span>
        </div>
      </div>

      <div class="filter-bar bank-toolbar">
        <input
          class="search-neu"
          type="search"
          placeholder="Search bank transactions..."
          bind:value={bankSearchQuery}
          aria-label="Search bank transactions"
        />
        <select class="select-neu" bind:value={bankStatusFilter} aria-label="Filter bank transactions by status">
          <option value="Unmatched">Unmatched</option>
          <option value="Matched">Matched</option>
          <option value="Disputed">Disputed</option>
          <option value="All">All</option>
        </select>
        <input
          class="bank-name-input"
          type="text"
          placeholder="Bank name"
          bind:value={bankImportBankName}
          aria-label="Bank name for import"
        />
        <button class="btn btn-gold btn-sm" onclick={triggerBankImportPicker} disabled={importingBankStatement}>
          {importingBankStatement ? 'Importing…' : 'Import CSV'}
        </button>
        <span class="filter-count">CSV import today, Excel/PDF next tranche.</span>
      </div>

      <div class="bank-recon-grid">
        <section class="bank-panel card">
          <div class="bank-panel-header">
            <div>
              <h3 class="bank-panel-title">Bank Transactions</h3>
              <p class="bank-panel-subtitle">Select a row to reconcile against open payment events.</p>
            </div>
            <span class="filter-count">{filteredBankTransactions.length} rows</span>
          </div>

          {#if filteredBankTransactions.length === 0}
            <div class="empty-state bank-empty">
              <div class="empty-glyph">&#9675;</div>
              <p class="empty-msg">No bank transactions match this filter yet.</p>
            </div>
          {:else}
            <div class="bank-list">
              {#each filteredBankTransactions as transaction}
                {@const status = (transaction.matchStatus as any)?.tag ?? 'Unmatched'}
                {@const topSuggestion = suggestMatches(transaction, paymentCandidates)[0]}
                <button
                  class="bank-row"
                  class:bank-row-active={selectedBankTransactionId === transaction.id}
                  type="button"
                  onclick={() => (selectedBankTransactionId = transaction.id)}
                >
                  <div class="bank-row-main">
                    <div class="bank-row-topline">
                      <span class="cell-date">{formatDate(transaction.transactionDate)}</span>
                      <span class="badge badge-{formatMatchStatus(status)}">{status}</span>
                    </div>
                    <span class="bank-row-desc">{transaction.description}</span>
                    <div class="bank-row-meta">
                      <span class="cell-ref">{transaction.reference || `TXN-${transaction.id}`}</span>
                      <span class:cell-amount-received={transaction.amountFils > 0n} class:cell-outstanding={transaction.amountFils < 0n} class="bank-row-amount">
                        {fmtBHDRaw(transaction.amountFils)} BHD
                      </span>
                    </div>
                    {#if topSuggestion && status === 'Unmatched'}
                      <span class="bank-row-hint">Top match: {topSuggestion.partyName} ({topSuggestion.reference || 'no ref'})</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <section class="bank-panel card">
          <div class="bank-panel-header">
            <div>
              <h3 class="bank-panel-title">Unmatched Payments</h3>
              <p class="bank-panel-subtitle">Exact amount matching is enforced before a reconciliation can be saved.</p>
            </div>
          </div>

          {#if !selectedBankTransaction}
            <div class="empty-state bank-empty">
              <div class="empty-glyph">&#9675;</div>
              <p class="empty-msg">Choose a bank transaction from the left to see ranked payment candidates.</p>
            </div>
          {:else}
            <div class="bank-detail card-inset">
              <div class="bank-detail-header">
                <div>
                  <div class="cell-date">{formatDate(selectedBankTransaction.transactionDate)} · {selectedBankTransaction.bankName}</div>
                  <div class="bank-detail-title">{selectedBankTransaction.description}</div>
                  <div class="cell-ref">{selectedBankTransaction.reference || `TXN-${selectedBankTransaction.id}`}</div>
                </div>
                <div class="bank-detail-amount" class:cell-amount-received={selectedBankTransaction.amountFils > 0n} class:cell-outstanding={selectedBankTransaction.amountFils < 0n}>
                  {fmtBHDRaw(selectedBankTransaction.amountFils)} BHD
                </div>
              </div>

              <div class="bank-detail-actions">
                <button
                  class="btn btn-sm"
                  disabled={!selectedCandidateId || bankActionInFlight}
                  onclick={() => selectedCandidateId && handleMatchBankTransaction(selectedCandidateId)}
                >
                  Match Selected
                </button>
                <button
                  class="btn btn-sm"
                  disabled={selectedBankSuggestions.length === 0 || bankActionInFlight}
                  onclick={() => selectedBankSuggestions[0] && handleMatchBankTransaction(selectedBankSuggestions[0].moneyEventId)}
                >
                  Auto-Match Top
                </button>
                <button
                  class="btn btn-sm"
                  disabled={bankActionInFlight}
                  onclick={handleDisputeSelectedBankTransaction}
                >
                  Mark Disputed
                </button>
              </div>
            </div>

            {#if displayedPaymentCandidates.length === 0}
              <div class="empty-state bank-empty">
                <div class="empty-glyph">&#9675;</div>
                <p class="empty-msg">No open payment events are available for matching.</p>
              </div>
            {:else}
              <div class="candidate-list">
                {#each displayedPaymentCandidates as candidate}
                  {@const eventRow = reconciliationEventMap.get(candidate.moneyEventId)}
                  {@const suggestion = selectedBankSuggestions.find((item) => item.moneyEventId === candidate.moneyEventId)}
                  <button
                    class="candidate-row"
                    class:candidate-row-active={selectedCandidateId === candidate.moneyEventId}
                    type="button"
                    onclick={() => (selectedCandidateId = candidate.moneyEventId)}
                  >
                    <div class="candidate-row-topline">
                      <span class="cell-name">{candidate.partyName}</span>
                      <span class="candidate-score">{suggestion ? `${suggestion.score}% fit` : 'Manual'}</span>
                    </div>
                    <div class="candidate-row-meta">
                      <span class="cell-ref">{candidate.reference || 'No reference'}</span>
                      <span class="badge badge-muted">{candidate.kind === 'SupplierPayment' ? 'Supplier' : 'Customer'}</span>
                    </div>
                    <div class="candidate-row-bottom">
                      <span class:cell-amount-received={candidate.signedAmountFils > 0n} class:cell-outstanding={candidate.signedAmountFils < 0n} class="bank-row-amount">
                        {fmtBHDRaw(candidate.signedAmountFils)} BHD
                      </span>
                      <span class="cell-date">{eventRow?.createdAtLabel ?? '—'}</span>
                    </div>
                    {#if suggestion}
                      <span class="candidate-reasons">{suggestion.reasons.join(' · ')}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      </div>

      <section class="bank-panel card">
        <div class="bank-panel-header">
          <div>
            <h3 class="bank-panel-title">Matched & Disputed Ledger</h3>
            <p class="bank-panel-subtitle">Recent reconciled rows stay visible so finance can undo or inspect them quickly.</p>
          </div>
        </div>

        {#if matchedBankTransactions.length === 0}
          <div class="empty-state bank-empty">
            <div class="empty-glyph">&#9675;</div>
            <p class="empty-msg">No bank transactions have been reconciled yet.</p>
          </div>
        {:else}
          <div class="table-shell card-inset">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th class="num-col">Amount</th>
                  <th>Status</th>
                  <th>Matched Event</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each matchedBankTransactions as transaction}
                  {@const status = (transaction.matchStatus as any)?.tag ?? 'Unmatched'}
                  {@const linkedEvent = transaction.matchedMoneyEventId ? reconciliationEventMap.get(transaction.matchedMoneyEventId) : null}
                  <tr class="table-row">
                    <td class="cell-date">{formatDate(transaction.transactionDate)}</td>
                    <td>
                      <div class="bank-ledger-cell">
                        <span class="cell-name">{transaction.description}</span>
                        <span class="cell-ref">{transaction.reference || `TXN-${transaction.id}`}</span>
                      </div>
                    </td>
                    <td class="num-col">
                      <span class:cell-amount-received={transaction.amountFils > 0n} class:cell-outstanding={transaction.amountFils < 0n} class="cell-amount">
                        {fmtBHDRaw(transaction.amountFils)}
                      </span>
                    </td>
                    <td><span class="badge badge-{formatMatchStatus(status)}">{status}</span></td>
                    <td class="cell-sm">
                      {#if linkedEvent}
                        <div class="bank-ledger-cell">
                          <span class="cell-name">{linkedEvent.partyName}</span>
                          <span class="cell-ref">{linkedEvent.reference || linkedEvent.kind}</span>
                        </div>
                      {:else}
                        <span class="cell-muted">Review required</span>
                      {/if}
                    </td>
                    <td>
                      {#if status === 'Matched'}
                        <button class="pdf-btn" onclick={() => handleUnmatchBankTransaction(transaction.id)} disabled={bankActionInFlight}>
                          Unmatch
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

    {:else if activeTab === 'tally'}
      <section class="tally-shell">
        <div class="tally-toolbar card">
          <div>
            <h3 class="bank-panel-title">Tally Workbook Import</h3>
            <p class="bank-panel-subtitle">
              Preview first, then import customer invoices, customer payments, supplier invoices, supplier payments, or AR defaulter reports from Tally Excel exports.
            </p>
          </div>

          <div class="filter-bar tally-toolbar-actions">
            <select
              class="select-neu"
              bind:value={tallyImportMode}
              onchange={() => {
                tallyPreview = null;
                tallyLastResult = null;
              }}
            >
              <option value="customer_invoices">Customer Invoices</option>
              <option value="supplier_invoices">Supplier Invoices</option>
              <option value="supplier_payments">Supplier Payments</option>
              <option value="customer_payments">Customer Payments</option>
              <option value="ar_defaulters">AR Defaulters (Audit)</option>
            </select>
            <button class="btn btn-sm" onclick={triggerTallyImportPicker} disabled={tallyParsing}>
              {tallyParsing ? 'Reading...' : 'Choose Workbook'}
            </button>
            <button
              class="btn btn-gold btn-sm"
              onclick={handleExecuteTallyImport}
              disabled={tallyImporting || !tallyPreview || tallyPreview.readyRows === 0}
            >
              {tallyImporting ? 'Importing...' : 'Import Ready Rows'}
            </button>
          </div>
        </div>

        {#if tallyPreview}
          <div class="bank-summary-grid">
            <div class="bank-summary-card card-subtle">
              <span class="bank-summary-label">Workbook</span>
              <span class="bank-summary-value tally-summary-text">{tallyPreview.fileName}</span>
            </div>
            <div class="bank-summary-card card-subtle">
              <span class="bank-summary-label">Ready</span>
              <span class="bank-summary-value">{tallyPreview.readyRows}</span>
            </div>
            <div class="bank-summary-card card-subtle">
              <span class="bank-summary-label">Duplicates</span>
              <span class="bank-summary-value">{tallyPreview.duplicateRows}</span>
            </div>
            <div class="bank-summary-card card-subtle">
              <span class="bank-summary-label">Invalid</span>
              <span class="bank-summary-value">{tallyPreview.invalidRows}</span>
            </div>
          </div>

          <div class="table-shell card">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Party</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th class="num-col">Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {#each tallyPreview.rows as row}
                  <tr class="table-row">
                    <td class="cell-sm">{row.rowNumber}</td>
                    <td>
                      <div class="bank-ledger-cell">
                        <span class="cell-name">{row.partyName || '—'}</span>
                        <span class="cell-ref">
                          {#if row.matchedPartyName}
                            Matched to {row.matchedPartyName}
                          {:else if row.willCreateParty}
                            New party will be created
                          {:else}
                            Review required
                          {/if}
                        </span>
                      </div>
                    </td>
                    <td class="cell-ref">{row.reference}</td>
                    <td class="cell-date">{row.transactionDate.toLocaleDateString('en-GB')}</td>
                    <td class="num-col">
                      <span class="cell-amount">{formatBHD(row.totalFils)}</span>
                    </td>
                    <td>
                      <span
                        class="badge badge-{row.status === 'ready' ? 'sage' : row.status === 'duplicate' ? 'amber' : 'coral'}"
                      >
                        {row.status}
                      </span>
                    </td>
                    <td class="cell-sm">
                      {#if row.issues.length > 0}
                        {row.issues.join(' ')}
                      {:else if row.status === 'duplicate'}
                        Existing money event already matches this row.
                      {:else}
                        Ready to import.
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-state">
            <div class="empty-glyph">&#9638;</div>
            <p class="empty-msg">Choose a Tally workbook to preview the import.</p>
          </div>
        {/if}

        {#if tallyLastResult}
          <div class="tally-result card-subtle">
            <div class="bank-detail-header">
              <span class="bank-detail-title">Last Import Result</span>
              <span class="cell-ref">
                {tallyLastResult.imported} imported / {tallyLastResult.duplicates} duplicates / {tallyLastResult.errors} errors
              </span>
            </div>
            <div class="tally-result-grid">
              <div class="bank-summary-card card">
                <span class="bank-summary-label">Imported</span>
                <span class="bank-summary-value">{tallyLastResult.imported}</span>
              </div>
              <div class="bank-summary-card card">
                <span class="bank-summary-label">New Parties</span>
                <span class="bank-summary-value">{tallyLastResult.createdParties}</span>
              </div>
              <div class="bank-summary-card card">
                <span class="bank-summary-label">Duplicates</span>
                <span class="bank-summary-value">{tallyLastResult.duplicates}</span>
              </div>
              <div class="bank-summary-card card">
                <span class="bank-summary-label">Errors</span>
                <span class="bank-summary-value">{tallyLastResult.errors}</span>
              </div>
            </div>

            {#if tallyLastResult.errorDetails.length > 0}
              <div class="tally-errors">
                {#each tallyLastResult.errorDetails as detail}
                  <div class="cell-sm cell-muted">{detail}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </section>

    <!-- AR AGING TAB -->
    {:else if activeTab === 'aging'}
      {@const displayAging = useLiveData ? agingRows : DEMO_AGING}
      {@const maxTotal = agingMaxTotal()}

      {#if (displayAging as any[]).length === 0}
        <div class="empty-state">
          <div class="empty-glyph">&#9675;</div>
          <p class="empty-msg">No outstanding receivables. All invoices paid.</p>
        </div>
      {:else}
        <!-- Aging summary row -->
        <div class="aging-summary">
          {#if useLiveData}
            <div class="aging-bucket card-subtle">
              <span class="aging-bucket-label">Current</span>
              <span class="aging-bucket-val aging-current">{fmtBHDRaw(agingTotals.d15)}</span>
            </div>
            <div class="aging-bucket card-subtle">
              <span class="aging-bucket-label">16-30 Days</span>
              <span class="aging-bucket-val aging-30">{fmtBHDRaw(agingTotals.d30)}</span>
            </div>
            <div class="aging-bucket card-subtle">
              <span class="aging-bucket-label">31-60 Days</span>
              <span class="aging-bucket-val aging-60">{fmtBHDRaw(agingTotals.d60)}</span>
            </div>
            <div class="aging-bucket card-subtle">
              <span class="aging-bucket-label">61-90 Days</span>
              <span class="aging-bucket-val aging-90">{fmtBHDRaw(agingTotals.d90)}</span>
            </div>
            <div class="aging-bucket card-subtle aging-bucket-danger">
              <span class="aging-bucket-label">90+ Days</span>
              <span class="aging-bucket-val aging-90plus">{fmtBHDRaw(agingTotals.d90plus)}</span>
            </div>
            <div class="aging-bucket card aging-bucket-total">
              <span class="aging-bucket-label">Total Outstanding</span>
              <span class="aging-bucket-val">{fmtBHDRaw(agingTotals.total)}</span>
            </div>
          {:else}
            {@const demoTotal = DEMO_AGING.reduce((s, r) => s + r.total, 0n)}
            {@const demoOverdue = DEMO_AGING.filter(r => r.d90plus > 0n || r.d90 > 0n).length}
            <div class="aging-meta-strip">
              <span class="aging-meta-item">
                <span class="label">Total Outstanding</span>
                <span class="aging-meta-val kpi-coral">{fmtBHDRaw(demoTotal)} BHD</span>
              </span>
              <span class="aging-meta-item">
                <span class="label">Customers Overdue</span>
                <span class="aging-meta-val kpi-coral">{demoOverdue}</span>
              </span>
            </div>
          {/if}
        </div>

        <!-- Aging bar visualization -->
        <div class="aging-bars card">
          <div class="aging-bars-header">
            <span class="aging-bars-legend">
              <span class="legend-dot legend-sage"></span><span class="legend-text">Current</span>
              <span class="legend-dot legend-amber"></span><span class="legend-text">30d</span>
              <span class="legend-dot legend-gold"></span><span class="legend-text">60d</span>
              <span class="legend-dot legend-coral-light"></span><span class="legend-text">90d</span>
              <span class="legend-dot legend-coral"></span><span class="legend-text">90d+</span>
            </span>
          </div>

          {#each displayAging as row}
            {@const total = Number((row as any).outstandingFils ?? (row as any).total)}
            {@const barWidth = (total / maxTotal * 100).toFixed(1)}
            {@const grade = (row as any).grade}
            <div class="aging-bar-row">
              <div class="aging-bar-meta">
                <div class="aging-bar-name">
                  <span class="grade-dot grade-{gradeColor[grade] ?? 'neutral'}">{grade}</span>
                  <span class="cell-name">{(row as any).name}</span>
                </div>
                <span class="aging-bar-total">{fmtBHDRaw((row as any).outstandingFils ?? (row as any).total)} BHD</span>
              </div>
              <div class="aging-bar-track card-inset">
                <div class="aging-bar-fill" style="width: {barWidth}%">
                  {#if useLiveData}
                    {#each agingBarSegments({
                      name: (row as any).name,
                      grade: (row as any).grade,
                      current: (row as any).d15Fils ?? 0n,
                      d30: (row as any).d30Fils ?? 0n,
                      d60: (row as any).d60Fils ?? 0n,
                      d90: (row as any).d90Fils ?? 0n,
                      d90plus: (row as any).d90plusFils ?? 0n,
                      total: (row as any).outstandingFils,
                    }) as seg}
                      <div
                        class="aging-seg aging-seg-{seg.color}"
                        style="width: {seg.pct}%"
                        title="{seg.label}: {fmtBHDRaw(seg.fils)} BHD"
                      ></div>
                    {/each}
                  {:else}
                    {#each agingBarSegments(row as any) as seg}
                      <div
                        class="aging-seg aging-seg-{seg.color}"
                        style="width: {seg.pct}%"
                        title="{seg.label}: {fmtBHDRaw(seg.fils)} BHD"
                      ></div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/each}

          <!-- Scale -->
          <div class="aging-scale">
            <span class="label">0 DAYS</span>
            <span class="label">30 DAYS</span>
            <span class="label">60 DAYS</span>
            <span class="label">90 DAYS</span>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'cheques'}
      <section class="cheque-shell">
        <div class="cheque-toolbar card">
          <div>
            <h3 class="bank-panel-title">Cheque Register</h3>
            <p class="bank-panel-subtitle">
              Track cheque issuance, presentation, clearance, and stale cheques.
            </p>
          </div>
          <div class="filter-bar">
            <select class="select-neu" bind:value={chequeFilter}>
              <option value="all">All Cheques</option>
              <option value="issued">Issued</option>
              <option value="presented">Presented</option>
              <option value="cleared">Cleared</option>
              <option value="bounced">Bounced</option>
              <option value="stale">Stale</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <!-- Summary chips -->
        <div class="cheque-summary">
          <div class="cheque-chip card-inset">
            <span class="cheque-chip-label">Pending</span>
            <span class="cheque-chip-value">{chequeSummary.totalPending}</span>
          </div>
          <div class="cheque-chip card-inset">
            <span class="cheque-chip-label">Outstanding</span>
            <span class="cheque-chip-value">{(Number(chequeSummary.outstandingAmountFils) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3 })} BHD</span>
          </div>
          <div class="cheque-chip card-inset">
            <span class="cheque-chip-label">Cleared</span>
            <span class="cheque-chip-value">{chequeSummary.totalCleared}</span>
          </div>
          <div class="cheque-chip card-inset">
            <span class="cheque-chip-label">Bounced</span>
            <span class="cheque-chip-value cheque-bounced">{chequeSummary.totalBounced}</span>
          </div>
        </div>

        <!-- Cheque table -->
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Cheque #</th>
                <th>Bank</th>
                <th>Payee</th>
                <th class="num">Amount (BHD)</th>
                <th>Issue Date</th>
                <th>Status</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {#each showCheques as ch (ch.id)}
                <tr>
                  <td class="mono">{ch.chequeNumber}</td>
                  <td>{ch.bankName}</td>
                  <td>{ch.payeeName}</td>
                  <td class="num mono">{(Number(ch.amountFils) / 1000).toLocaleString('en-BH', { minimumFractionDigits: 3 })}</td>
                  <td class="mono">{ch.issueDate}</td>
                  <td>
                    <span class="cheque-status cheque-status-{ch.status}">{ch.status}</span>
                  </td>
                  <td class="mono">{ch.reference}</td>
                </tr>
              {/each}
              {#if showCheques.length === 0}
                <tr><td colspan="7" class="empty-row">No cheques match the current filter.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

  </div>
</div>

<input
  bind:this={bankImportInput}
  class="bank-import-input"
  type="file"
  accept=".csv,text/csv"
  onchange={handleBankImportSelected}
/>

<input
  bind:this={tallyImportInput}
  class="bank-import-input"
  type="file"
  accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  onchange={handleTallyFileSelected}
/>

<CreateInvoiceModal open={showCreateInvoice} onclose={() => (showCreateInvoice = false)} />
<RecordPaymentModal open={showRecordPayment} onclose={() => (showRecordPayment = false)} />

<style>
  /* ── Layout ── */
  .hub-page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    padding: var(--sp-24);
    max-width: 1200px;
    margin: 0 auto;
  }

  .hub-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-16);
  }

  .hub-title-group {
    min-width: 120px;
  }

  .hub-title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.05em;
    margin: 0;
    line-height: 1;
  }

  /* ── KPI Strip ── */
  .kpi-strip {
    display: flex;
    gap: var(--sp-13);
    flex-wrap: wrap;
    flex: 1;
    justify-content: center;
  }

  .kpi-card {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-3);
    padding: var(--sp-13) var(--sp-16);
    border-radius: 14px;
    min-width: 150px;
  }

  .kpi-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .kpi-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--ink);
    line-height: 1;
  }

  .kpi-unit {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .kpi-sage  { color: var(--sage); }
  .kpi-coral { color: var(--coral); }
  .kpi-amber { color: var(--amber); }

  .hub-actions {
    display: flex;
    gap: var(--sp-8);
    align-items: center;
    flex-shrink: 0;
  }

  .btn-sm {
    padding: var(--sp-8) var(--sp-13);
    font-size: var(--text-sm);
  }

  /* ── Tabs ── */
  .tabs-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--ink-12);
  }

  .tab-btn {
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-30);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--sp-8) var(--sp-21);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
    margin-bottom: -1px;
    white-space: nowrap;
  }

  .tab-btn:hover { color: var(--ink); }

  .tab-active {
    color: var(--gold);
    border-bottom-color: var(--gold);
  }

  .tab-content { overflow: hidden; }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: var(--sp-8);
    align-items: center;
    margin-bottom: var(--sp-16);
    flex-wrap: wrap;
  }

  .search-neu {
    flex: 1;
    min-width: 180px;
    max-width: 280px;
    height: 36px;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-inset);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 var(--sp-13);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    outline: none;
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .search-neu:focus {
    box-shadow: var(--shadow-neu-inset), 0 0 0 2px var(--gold-soft);
  }

  .search-neu::placeholder { color: var(--ink-30); }

  .select-neu {
    height: 36px;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 var(--sp-13);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-60);
    cursor: pointer;
    outline: none;
  }

  .filter-count {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-30);
    white-space: nowrap;
  }

  /* ── Table shell ── */
  .table-shell {
    border-radius: 14px;
    overflow: hidden;
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .data-table thead tr {
    background: var(--paper-elevated);
    border-bottom: 1px solid var(--ink-12);
  }

  .data-table th {
    text-align: left;
    padding: var(--sp-13) var(--sp-16);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-60);
    white-space: nowrap;
  }

  .num-col { text-align: right; }

  .table-row {
    border-bottom: 1px solid var(--ink-06);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .table-row:last-child { border-bottom: none; }

  .table-row:hover { background: var(--ink-03); }

  .row-overdue {
    border-left: 3px solid rgba(196, 121, 107, 0.4);
  }

  .data-table td {
    padding: var(--sp-10) var(--sp-16);
    color: var(--ink);
    white-space: nowrap;
  }

  /* ── Cell styles ── */
  .cell-ref {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-60);
    letter-spacing: 0.02em;
  }

  .cell-name {
    font-weight: 500;
    color: var(--ink);
  }

  .cell-amount {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    font-weight: 400;
    letter-spacing: -0.02em;
    display: block;
    text-align: right;
  }

  .cell-amount-received {
    color: var(--sage);
  }

  .amount-sub {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    display: block;
    text-align: right;
    margin-top: 1px;
  }

  .cell-outstanding { color: var(--coral); }
  .cell-date { color: var(--ink-60); font-size: var(--text-xs); }
  .date-overdue { color: var(--coral); }
  .cell-muted { color: var(--ink-30); }
  .cell-sm { font-size: var(--text-xs); }

  .days-over {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--coral);
  }

  .customer-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  /* ── Grade dots ── */
  .grade-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .grade-sage   { background: var(--sage-soft);  color: var(--sage); }
  .grade-blue   { background: var(--blue-soft);  color: var(--blue); }
  .grade-amber  { background: var(--amber-soft); color: var(--amber); }
  .grade-coral  { background: var(--coral-soft); color: var(--coral); }
  .grade-neutral { background: var(--ink-06);    color: var(--ink-60); }

  /* ── Method chip ── */
  .method-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--sp-2) var(--sp-8);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--ink-60);
  }

  /* ── PDF button ── */
  .pdf-btn {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--ink-60);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--sp-2) var(--sp-8);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .pdf-btn:hover:not(:disabled) { color: var(--gold); }
  .pdf-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── MTD Banner ── */
  .mtd-banner {
    display: flex;
    align-items: baseline;
    gap: var(--sp-13);
    padding: var(--sp-13) var(--sp-21);
    border-radius: 14px;
    margin-bottom: var(--sp-16);
  }

  .mtd-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .mtd-value {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--sage);
  }

  .bank-import-input {
    display: none;
  }

  .bank-toolbar {
    margin-bottom: var(--sp-13);
  }

  .bank-name-input {
    height: 36px;
    min-width: 120px;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 var(--sp-13);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .bank-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-13);
    margin-bottom: var(--sp-16);
  }

  .bank-summary-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding: var(--sp-13) var(--sp-16);
    border-radius: 14px;
  }

  .bank-summary-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .bank-summary-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    color: var(--ink);
  }

  .bank-recon-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: var(--sp-16);
    margin-bottom: var(--sp-16);
  }

  .bank-panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-16);
    border-radius: 14px;
  }

  .bank-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-13);
  }

  .bank-panel-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    color: var(--ink);
  }

  .bank-panel-subtitle {
    margin: var(--sp-3) 0 0;
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .bank-list,
  .candidate-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .bank-row,
  .candidate-row {
    width: 100%;
    text-align: left;
    border: 1px solid transparent;
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    border-radius: 12px;
    padding: var(--sp-13);
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }

  .bank-row:hover,
  .candidate-row:hover,
  .bank-row-active,
  .candidate-row-active {
    border-color: var(--gold-soft);
    transform: translateY(-1px);
  }

  .bank-row-main,
  .bank-ledger-cell {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .bank-row-topline,
  .candidate-row-topline,
  .candidate-row-meta,
  .candidate-row-bottom,
  .bank-row-meta,
  .bank-detail-header,
  .bank-detail-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  .bank-row-desc,
  .bank-detail-title {
    font-weight: 600;
    color: var(--ink);
  }

  .bank-row-amount,
  .bank-detail-amount {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .bank-row-hint,
  .candidate-reasons,
  .candidate-score {
    font-size: var(--text-xs);
    color: var(--ink-30);
  }

  .bank-detail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-13);
    border-radius: 12px;
  }

  .bank-empty {
    padding: var(--sp-34) var(--sp-13);
  }

  .tally-shell {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
  }

  .tally-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-16);
    flex-wrap: wrap;
    padding: var(--sp-16);
    border-radius: 14px;
  }

  .tally-toolbar-actions {
    margin-bottom: 0;
    justify-content: flex-end;
  }

  .tally-summary-text {
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .tally-result {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-16);
    border-radius: 14px;
  }

  .tally-result-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-13);
  }

  .tally-errors {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  /* ── Aging summary ── */
  .aging-summary {
    margin-bottom: var(--sp-16);
  }

  .aging-meta-strip {
    display: flex;
    gap: var(--sp-34);
    padding: var(--sp-13) 0;
  }

  .aging-meta-item {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .aging-meta-val {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 300;
    letter-spacing: -0.03em;
  }

  .aging-bucket {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-3);
    padding: var(--sp-8) var(--sp-13);
    border-radius: var(--radius-md);
    margin-right: var(--sp-8);
    margin-bottom: var(--sp-8);
  }

  .aging-bucket-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .aging-bucket-val {
    font-family: var(--font-data);
    font-size: var(--text-base);
    font-weight: 400;
    color: var(--ink);
    letter-spacing: -0.02em;
  }

  .aging-bucket-danger .aging-bucket-val { color: var(--coral); }
  .aging-bucket-total .aging-bucket-val  { color: var(--gold); font-size: var(--text-md); }

  .aging-current { color: var(--sage); }
  .aging-30      { color: var(--amber); }
  .aging-60      { color: var(--amber); }
  .aging-90      { color: var(--coral); opacity: 0.7; }
  .aging-90plus  { color: var(--coral); }

  /* ── Aging bar visualization ── */
  .aging-bars {
    border-radius: 14px;
    padding: var(--sp-21);
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
  }

  .aging-bars-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--sp-8);
  }

  .aging-bars-legend {
    display: flex;
    align-items: center;
    gap: var(--sp-13);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-text {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-30);
    margin-right: var(--sp-5);
  }

  .legend-sage         { background: var(--sage); }
  .legend-amber        { background: var(--amber); }
  .legend-gold         { background: var(--gold); }
  .legend-coral-light  { background: rgba(196, 121, 107, 0.5); }
  .legend-coral        { background: var(--coral); }

  .aging-bar-row {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .aging-bar-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .aging-bar-name {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
  }

  .aging-bar-total {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
    letter-spacing: -0.01em;
  }

  .aging-bar-track {
    height: 18px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--paper-card);
  }

  .aging-bar-fill {
    height: 100%;
    display: flex;
    transition: width var(--dur-slow) var(--ease-out);
    min-width: 2px;
  }

  .aging-seg {
    height: 100%;
    transition: width var(--dur-slow) var(--ease-out);
    min-width: 2px;
  }

  .aging-seg-sage        { background: var(--sage); opacity: 0.85; }
  .aging-seg-amber       { background: var(--amber); opacity: 0.85; }
  .aging-seg-gold        { background: var(--gold); opacity: 0.85; }
  .aging-seg-coral-light { background: var(--coral); opacity: 0.45; }
  .aging-seg-coral       { background: var(--coral); opacity: 0.9; }

  .aging-scale {
    display: flex;
    justify-content: space-between;
    padding: var(--sp-5) 0 0;
    border-top: 1px solid var(--ink-06);
  }

  .aging-scale .label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-55) var(--sp-13);
    color: var(--ink-30);
  }

  .empty-glyph {
    font-size: 32px;
    line-height: 1;
    opacity: 0.4;
  }

  .empty-msg {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink-30);
    text-align: center;
    margin: 0;
  }

  @media (max-width: 980px) {
    .bank-summary-grid,
    .bank-recon-grid,
    .tally-result-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ── Cheque Register ── */

  .cheque-shell {
    display: flex;
    flex-direction: column;
    gap: var(--sp-16);
  }

  .cheque-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--sp-16);
    padding: var(--sp-16);
  }

  .cheque-summary {
    display: flex;
    gap: var(--sp-10);
    flex-wrap: wrap;
  }

  .cheque-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--sp-10) var(--sp-16);
    border-radius: var(--radius-md);
    min-width: 100px;
  }

  .cheque-chip-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-30);
  }

  .cheque-chip-value {
    font-family: var(--font-data);
    font-size: var(--text-lg);
    color: var(--ink);
  }

  .cheque-bounced {
    color: var(--coral);
  }

  .cheque-status {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    text-transform: capitalize;
  }

  .cheque-status-issued { background: var(--gold-glow); color: var(--gold); }
  .cheque-status-presented { background: var(--blue-soft); color: var(--blue); }
  .cheque-status-cleared { background: var(--sage-soft); color: var(--sage); }
  .cheque-status-bounced { background: var(--coral-soft); color: var(--coral); }
  .cheque-status-stale { background: var(--ink-06); color: var(--ink-30); }
  .cheque-status-cancelled { background: var(--ink-06); color: var(--ink-30); }
</style>
