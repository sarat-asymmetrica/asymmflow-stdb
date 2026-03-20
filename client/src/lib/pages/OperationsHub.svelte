<script lang="ts">
  import { get } from 'svelte/store';
  import { Timestamp } from 'spacetimedb';
  import {
    deliveryNoteItems,
    deliveryNotes,
    getConnection,
    grnItems,
    grns,
    lineItems,
    nicknameMap,
    orders,
    parties,
    purchaseOrders
  } from '../db';
  import { formatBHD, formatDate } from '../format';
  import { toast } from '../stores';
  import { enter } from '$lib/motion/asymm-motion';

  type TabId = 'orders' | 'delivery_notes' | 'grns' | 'pos';

  type PoDraftItem = {
    clientId: number;
    description: string;
    quantity: string;
    unitPriceBhd: string;
  };

  let activeTab = $state<TabId>('orders');
  let selectedDnId = $state<bigint | null>(null);
  let selectedGrnId = $state<bigint | null>(null);
  let selectedPoId = $state<bigint | null>(null);

  let showNewDnModal = $state(false);
  let showNewGrnModal = $state(false);
  let showNewPoModal = $state(false);

  let submittingDn = $state(false);
  let submittingGrn = $state(false);
  let submittingPo = $state(false);
  let detailBusy = $state(false);

  let dnError = $state('');
  let grnError = $state('');
  let poError = $state('');
  let detailError = $state('');

  let dnForm = $state({
    orderId: '',
    deliveryAddress: '',
    driverName: '',
    vehicleNumber: ''
  });

  let grnForm = $state({
    purchaseOrderId: '',
    receivedDate: new Date().toISOString().slice(0, 10),
    inspectionNotes: ''
  });

  let poForm = $state({
    partyId: '',
    orderId: '',
    deliveryTerms: 'CIF Bahrain unless otherwise specified'
  });
  let poDraftItems = $state<PoDraftItem[]>([
    { clientId: 1, description: '', quantity: '1', unitPriceBhd: '' }
  ]);
  let nextDraftItemId = 2;

  let dnItemForm = $state({
    lineItemId: '',
    quantity: '',
    notes: ''
  });
  let dnAdvanceForm = $state({
    receiverName: '',
    notes: ''
  });

  let grnItemForm = $state({
    lineItemId: '',
    quantityReceived: '',
    quantityAccepted: '',
    notes: ''
  });
  let grnAdvanceNotes = $state('');

  let poLineForm = $state({
    description: '',
    quantity: '1',
    unitPriceBhd: ''
  });

  const tabs: { id: TabId; label: string }[] = [
    { id: 'orders', label: 'Orders' },
    { id: 'delivery_notes', label: 'Delivery Notes' },
    { id: 'grns', label: 'GRNs' },
    { id: 'pos', label: 'Purchase Orders' }
  ];

  const STATUS_LABELS: Record<string, string> = {
    Draft: 'Draft',
    Active: 'Active',
    InProgress: 'In Progress',
    Terminal: 'Completed',
    Cancelled: 'Cancelled',
    Dispatched: 'Dispatched',
    Delivered: 'Delivered',
    Returned: 'Returned',
    Inspecting: 'Inspecting',
    Accepted: 'Accepted',
    Rejected: 'Rejected'
  };

  const STATUS_COLORS: Record<string, string> = {
    Draft: 'neutral',
    Active: 'gold',
    InProgress: 'sage',
    Terminal: 'muted',
    Cancelled: 'coral',
    Dispatched: 'gold',
    Delivered: 'sage',
    Returned: 'coral',
    Inspecting: 'amber',
    Accepted: 'sage',
    Rejected: 'coral'
  };

  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusColor(status: string): string {
    return STATUS_COLORS[status] ?? 'neutral';
  }

  function parseBhdToFils(value: string): bigint | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) return null;
    return BigInt(Math.round(num * 1000));
  }

  function parseWholeQuantity(value: string): bigint | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    return BigInt(trimmed);
  }

  function totalDraftItemFils(item: PoDraftItem): bigint {
    const qty = parseWholeQuantity(item.quantity) ?? 0n;
    const unit = parseBhdToFils(item.unitPriceBhd) ?? 0n;
    return qty * unit;
  }

  async function waitForNewId<T extends { id: bigint }>(
    readRows: () => T[],
    previousIds: Set<bigint>,
    timeoutMs = 4000
  ): Promise<bigint> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const next = readRows().find((row) => !previousIds.has(row.id));
      if (next) return next.id;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for live database update.');
  }

  function openNewDnModal() {
    dnForm = { orderId: '', deliveryAddress: '', driverName: '', vehicleNumber: '' };
    dnError = '';
    showNewDnModal = true;
  }

  function openNewGrnModal() {
    grnForm = {
      purchaseOrderId: '',
      receivedDate: new Date().toISOString().slice(0, 10),
      inspectionNotes: ''
    };
    grnError = '';
    showNewGrnModal = true;
  }

  function openNewPoModal() {
    poForm = { partyId: '', orderId: '', deliveryTerms: 'CIF Bahrain unless otherwise specified' };
    poDraftItems = [{ clientId: 1, description: '', quantity: '1', unitPriceBhd: '' }];
    nextDraftItemId = 2;
    poError = '';
    showNewPoModal = true;
  }

  function closeAllModals() {
    if (submittingDn || submittingGrn || submittingPo) return;
    showNewDnModal = false;
    showNewGrnModal = false;
    showNewPoModal = false;
  }

  function handleModalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeAllModals();
  }

  let partyMap = $derived.by(() => new Map($parties.map((p) => [p.id, p])));
  let orderMap = $derived.by(() => new Map($orders.map((o) => [o.id, o])));
  let purchaseOrderMap = $derived.by(() => new Map($purchaseOrders.map((po) => [po.id, po])));

  let supplierParties = $derived.by(() =>
    $parties.filter((p) => (p as any).isSupplier === true || (p as any).isSupplier === 1)
  );

  let deliveryNotesByOrder = $derived.by(() => {
    const map = new Map<bigint, typeof $deliveryNotes>();
    for (const note of $deliveryNotes) {
      const rows = map.get(note.orderId) ?? [];
      rows.push(note);
      map.set(note.orderId, rows);
    }
    return map;
  });

  let lineItemsByParent = $derived.by(() => {
    const map = new Map<string, typeof $lineItems>();
    for (const item of $lineItems) {
      const key = `${item.parentType}:${item.parentId}`;
      const rows = map.get(key) ?? [];
      rows.push(item);
      map.set(key, rows);
    }
    return map;
  });

  let deliveryItemsByDn = $derived.by(() => {
    const map = new Map<bigint, typeof $deliveryNoteItems>();
    for (const item of $deliveryNoteItems) {
      const rows = map.get(item.deliveryNoteId) ?? [];
      rows.push(item);
      map.set(item.deliveryNoteId, rows);
    }
    return map;
  });

  let grnItemsByGrn = $derived.by(() => {
    const map = new Map<bigint, typeof $grnItems>();
    for (const item of $grnItems) {
      const rows = map.get(item.grnId) ?? [];
      rows.push(item);
      map.set(item.grnId, rows);
    }
    return map;
  });

  let deliveredByLineItem = $derived.by(() => {
    const returnedDnIds = new Set(
      $deliveryNotes.filter((n) => n.status.tag === 'Returned').map((n) => n.id)
    );
    const map = new Map<bigint, bigint>();
    for (const item of $deliveryNoteItems) {
      if (returnedDnIds.has(item.deliveryNoteId)) continue;
      map.set(item.lineItemId, (map.get(item.lineItemId) ?? 0n) + item.quantityDelivered);
    }
    return map;
  });

  let acceptedByLineItem = $derived.by(() => {
    const acceptedGrnIds = new Set(
      $grns.filter((g) => g.status.tag === 'Accepted').map((g) => g.id)
    );
    const map = new Map<bigint, bigint>();
    for (const item of $grnItems) {
      if (!acceptedGrnIds.has(item.grnId)) continue;
      map.set(item.lineItemId, (map.get(item.lineItemId) ?? 0n) + item.quantityAccepted);
    }
    return map;
  });

  let orderRows = $derived.by(() =>
    $orders
      .map((order) => {
        const party = partyMap.get(order.partyId);
        const notes = deliveryNotesByOrder.get(order.id) ?? [];
        const items = lineItemsByParent.get(`order:${order.id}`) ?? [];
        const delivered = items.reduce((sum, item) => sum + (deliveredByLineItem.get(item.id) ?? 0n), 0n);
        const ordered = items.reduce((sum, item) => sum + item.quantity, 0n);
        return {
          id: order.id,
          ref: `ORD-${String(order.id).padStart(3, '0')}`,
          customer: party?.name ?? '-',
          status: order.status.tag,
          poRef: order.poReference || '-',
          expectedDelivery: order.expectedDelivery ? formatDate(order.expectedDelivery) : '-',
          createdAt: formatDate(order.createdAt),
          total: formatBHD(order.totalFils),
          dnCount: notes.length,
          deliveredProgress: ordered === 0n ? '-' : `${delivered}/${ordered}`
        };
      })
      .sort((a, b) => Number(b.id - a.id))
  );

  let dnRows = $derived.by(() =>
    $deliveryNotes
      .map((note) => {
        const order = orderMap.get(note.orderId);
        const party = partyMap.get(note.partyId);
        const items = deliveryItemsByDn.get(note.id) ?? [];
        return {
          id: note.id,
          dnNumber: note.dnNumber,
          orderRef: order ? `ORD-${String(order.id).padStart(3, '0')}` : '-',
          customer: party?.name ?? '-',
          status: note.status.tag,
          deliveryDate: formatDate(note.deliveryDate),
          driverName: note.driverName || '-',
          vehicleNumber: note.vehicleNumber || '-',
          receiverName: note.receiverName || '-',
          itemCount: items.length
        };
      })
      .sort((a, b) => Number(b.id - a.id))
  );

  let grnRows = $derived.by(() =>
    $grns
      .map((grn) => {
        const po = purchaseOrderMap.get(grn.purchaseOrderId);
        const supplier = po ? partyMap.get(po.partyId) : null;
        const items = grnItemsByGrn.get(grn.id) ?? [];
        return {
          id: grn.id,
          grnNumber: grn.grnNumber,
          poRef: po ? `PO-${String(po.id).padStart(3, '0')}` : '-',
          supplier: supplier?.name ?? '-',
          status: grn.status.tag,
          receivedDate: formatDate(grn.receivedDate),
          itemCount: items.length
        };
      })
      .sort((a, b) => Number(b.id - a.id))
  );

  let poRows = $derived.by(() =>
    $purchaseOrders
      .map((po) => {
        const supplier = partyMap.get(po.partyId);
        const linkedOrder = po.orderId ? orderMap.get(po.orderId) : null;
        const items = lineItemsByParent.get(`purchase_order:${po.id}`) ?? [];
        const now = Date.now();
        // expectedDelivery is not on PurchaseOrder directly; derive from linked order
        const expectedDelivery = linkedOrder?.expectedDelivery
          ? formatDate(linkedOrder.expectedDelivery)
          : '-';
        const expectedDeliveryMs = linkedOrder?.expectedDelivery
          ? Number(linkedOrder.expectedDelivery.microsSinceUnixEpoch / 1000n)
          : null;
        const isPastDue =
          expectedDeliveryMs !== null &&
          expectedDeliveryMs < now &&
          po.status.tag !== 'Terminal' &&
          po.status.tag !== 'Cancelled';
        return {
          id: po.id,
          ref: `PO-${String(po.id).padStart(3, '0')}`,
          supplier: supplier?.name ?? '-',
          orderRef: linkedOrder ? `ORD-${String(linkedOrder.id).padStart(3, '0')}` : '-',
          status: po.status.tag,
          total: formatBHD(po.totalFils),
          totalFils: po.totalFils,
          createdAt: formatDate(po.createdAt),
          createdBy: $nicknameMap.get(String(po.createdBy)) ?? '-',
          itemCount: items.length,
          expectedDelivery,
          isPastDue
        };
      })
      .sort((a, b) => Number(b.id - a.id))
  );

  let selectedDn = $derived($deliveryNotes.find((n) => n.id === selectedDnId) ?? null);
  let selectedGrn = $derived($grns.find((g) => g.id === selectedGrnId) ?? null);
  let selectedPo = $derived($purchaseOrders.find((po) => po.id === selectedPoId) ?? null);

  let selectedDnOrderItems = $derived.by(() => {
    if (!selectedDn) return [];
    const items = lineItemsByParent.get(`order:${selectedDn.orderId}`) ?? [];
    return items.map((item) => {
      const delivered = deliveredByLineItem.get(item.id) ?? 0n;
      return { ...item, delivered, remaining: item.quantity > delivered ? item.quantity - delivered : 0n };
    });
  });

  let selectedDnItems = $derived.by(() => {
    if (!selectedDn) return [];
    const items = deliveryItemsByDn.get(selectedDn.id) ?? [];
    return items.map((item) => {
      const line = $lineItems.find((row) => row.id === item.lineItemId);
      return { ...item, description: line?.description ?? `Line item #${item.lineItemId}` };
    });
  });

  let selectedGrnPoItems = $derived.by(() => {
    if (!selectedGrn) return [];
    const po = purchaseOrderMap.get(selectedGrn.purchaseOrderId);
    if (!po) return [];
    const items = lineItemsByParent.get(`purchase_order:${po.id}`) ?? [];
    return items.map((item) => {
      const accepted = acceptedByLineItem.get(item.id) ?? 0n;
      return { ...item, accepted, remaining: item.quantity > accepted ? item.quantity - accepted : 0n };
    });
  });

  let selectedGrnItems = $derived.by(() => {
    if (!selectedGrn) return [];
    const items = grnItemsByGrn.get(selectedGrn.id) ?? [];
    return items.map((item) => {
      const line = $lineItems.find((row) => row.id === item.lineItemId);
      return { ...item, description: line?.description ?? `Line item #${item.lineItemId}` };
    });
  });

  let selectedPoItems = $derived.by(() => {
    if (!selectedPo) return [];
    return lineItemsByParent.get(`purchase_order:${selectedPo.id}`) ?? [];
  });

  let availableOrderOptions = $derived.by(() =>
    $orders
      .filter((o) => o.status.tag === 'Active' || o.status.tag === 'InProgress')
      .map((o) => ({
        id: o.id,
        label: `ORD-${String(o.id).padStart(3, '0')} · ${partyMap.get(o.partyId)?.name ?? '-'}`,
        partyId: o.partyId
      }))
      .sort((a, b) => Number(b.id - a.id))
  );

  let availableDnOrders = $derived.by(() =>
    $orders
      .filter((o) => o.status.tag === 'Active' || o.status.tag === 'InProgress')
      .map((o) => ({
        id: o.id,
        partyId: o.partyId,
        label: `ORD-${String(o.id).padStart(3, '0')} · ${partyMap.get(o.partyId)?.name ?? '-'}`
      }))
      .sort((a, b) => Number(b.id - a.id))
  );

  let availableGrnPos = $derived.by(() =>
    $purchaseOrders
      .filter((po) => po.status.tag === 'Active' || po.status.tag === 'InProgress')
      .map((po) => ({
        id: po.id,
        label: `PO-${String(po.id).padStart(3, '0')} · ${partyMap.get(po.partyId)?.name ?? '-'}`
      }))
      .sort((a, b) => Number(b.id - a.id))
  );

  // ── Summary KPIs ──────────────────────────────────────────────────────────

  let activeOrderCount = $derived(
    $orders.filter((o) => o.status.tag === 'Active' || o.status.tag === 'InProgress').length
  );
  let inTransitCount = $derived(
    $deliveryNotes.filter((n) => n.status.tag === 'Dispatched').length
  );
  let deliveredMtdCount = $derived.by(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return $deliveryNotes.filter((n) => {
      if (n.status.tag !== 'Delivered') return false;
      const ms = Number(n.updatedAt.microsSinceUnixEpoch / 1000n);
      return ms >= startOfMonth;
    }).length;
  });

  // ── Mutation helpers ──────────────────────────────────────────────────────

  function addDraftPoItem() {
    poDraftItems = [
      ...poDraftItems,
      { clientId: nextDraftItemId++, description: '', quantity: '1', unitPriceBhd: '' }
    ];
  }

  function removeDraftPoItem(clientId: number) {
    if (poDraftItems.length === 1) return;
    poDraftItems = poDraftItems.filter((item) => item.clientId !== clientId);
  }

  function updateDraftPoItem(clientId: number, field: keyof PoDraftItem, value: string) {
    poDraftItems = poDraftItems.map((item) =>
      item.clientId === clientId ? { ...item, [field]: value } : item
    );
  }

  async function submitNewPo() {
    poError = '';
    const conn = getConnection();
    if (!conn) { poError = 'Not connected to database.'; return; }
    if (!poForm.partyId) { poError = 'Select a supplier.'; return; }

    const normalizedItems = poDraftItems.map((item) => ({
      description: item.description.trim(),
      quantity: parseWholeQuantity(item.quantity),
      unitPriceFils: parseBhdToFils(item.unitPriceBhd)
    }));

    if (normalizedItems.some((i) => !i.description || i.quantity === null || i.unitPriceFils === null)) {
      poError = 'Each line item needs a description, quantity, and unit price.';
      return;
    }

    const totalFils = normalizedItems.reduce(
      (sum, i) => sum + (i.quantity ?? 0n) * (i.unitPriceFils ?? 0n),
      0n
    );

    submittingPo = true;
    try {
      const existingIds = new Set(get(purchaseOrders).map((r) => r.id));
      conn.reducers.managePurchaseOrder({
        id: 0n,
        partyId: BigInt(poForm.partyId),
        orderId: poForm.orderId ? BigInt(poForm.orderId) : undefined,
        deliveryTerms: poForm.deliveryTerms.trim() || undefined,
        newStatus: { tag: 'Draft' } as any,
        totalFils
      });

      const newPoId = await waitForNewId(() => get(purchaseOrders), existingIds);

      for (const item of normalizedItems) {
        conn.reducers.addLineItem({
          parentType: 'purchase_order',
          parentId: newPoId,
          description: item.description,
          quantity: item.quantity ?? 0n,
          unitPriceFils: item.unitPriceFils ?? 0n,
          fobCostFils: undefined,
          freightCostFils: undefined,
          customsCostFils: undefined,
          insuranceCostFils: undefined,
          handlingCostFils: undefined,
          financeCostFils: undefined,
          marginBps: undefined,
          costPerUnitFils: undefined
        });
      }

      showNewPoModal = false;
      activeTab = 'pos';
      selectedPoId = newPoId;
      toast.success('Purchase order created with line items.');
    } catch (err: any) {
      poError = err?.message ?? 'Failed to create purchase order.';
    } finally {
      submittingPo = false;
    }
  }

  async function submitNewDn() {
    dnError = '';
    const conn = getConnection();
    if (!conn) { dnError = 'Not connected to database.'; return; }
    if (!dnForm.orderId || !dnForm.deliveryAddress.trim() || !dnForm.driverName.trim()) {
      dnError = 'Order, delivery address, and driver name are required.';
      return;
    }

    const selectedOrder = get(orders).find((o) => o.id === BigInt(dnForm.orderId));
    if (!selectedOrder) { dnError = 'Selected order was not found.'; return; }

    submittingDn = true;
    try {
      const existingIds = new Set(get(deliveryNotes).map((r) => r.id));
      conn.reducers.createDeliveryNote({
        orderId: selectedOrder.id,
        partyId: selectedOrder.partyId,
        deliveryAddress: dnForm.deliveryAddress.trim(),
        driverName: dnForm.driverName.trim(),
        vehicleNumber: dnForm.vehicleNumber.trim()
      });
      const newDnId = await waitForNewId(() => get(deliveryNotes), existingIds);
      showNewDnModal = false;
      activeTab = 'delivery_notes';
      selectedDnId = newDnId;
      dnItemForm = { lineItemId: '', quantity: '', notes: '' };
      dnAdvanceForm = { receiverName: '', notes: '' };
      toast.success('Delivery note created.');
    } catch (err: any) {
      dnError = err?.message ?? 'Failed to create delivery note.';
    } finally {
      submittingDn = false;
    }
  }

  async function submitNewGrn() {
    grnError = '';
    const conn = getConnection();
    if (!conn) { grnError = 'Not connected to database.'; return; }
    if (!grnForm.purchaseOrderId || !grnForm.receivedDate) {
      grnError = 'Purchase order and received date are required.';
      return;
    }

    submittingGrn = true;
    try {
      const existingIds = new Set(get(grns).map((r) => r.id));
      conn.reducers.createGrn({
        purchaseOrderId: BigInt(grnForm.purchaseOrderId),
        receivedDate: Timestamp.fromDate(new Date(grnForm.receivedDate)),
        inspectionNotes: grnForm.inspectionNotes.trim()
      });
      const newGrnId = await waitForNewId(() => get(grns), existingIds);
      showNewGrnModal = false;
      activeTab = 'grns';
      selectedGrnId = newGrnId;
      grnItemForm = { lineItemId: '', quantityReceived: '', quantityAccepted: '', notes: '' };
      grnAdvanceNotes = '';
      toast.success('GRN created.');
    } catch (err: any) {
      grnError = err?.message ?? 'Failed to create GRN.';
    } finally {
      submittingGrn = false;
    }
  }

  async function submitDnItem() {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedDn) return;

    const quantityDelivered = parseWholeQuantity(dnItemForm.quantity);
    if (!dnItemForm.lineItemId || quantityDelivered === null || quantityDelivered === 0n) {
      detailError = 'Select an order line item and enter a quantity.';
      return;
    }

    detailBusy = true;
    try {
      conn.reducers.addDeliveryNoteItem({
        deliveryNoteId: selectedDn.id,
        lineItemId: BigInt(dnItemForm.lineItemId),
        quantityDelivered,
        notes: dnItemForm.notes.trim()
      });
      dnItemForm = { lineItemId: '', quantity: '', notes: '' };
      toast.success('Delivery note item added.');
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to add delivery note item.';
    } finally {
      detailBusy = false;
    }
  }

  async function advanceDn(newStatus: 'Dispatched' | 'Delivered' | 'Returned') {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedDn) return;
    if (newStatus === 'Delivered' && !dnAdvanceForm.receiverName.trim()) {
      detailError = 'Receiver name is required when marking delivered.';
      return;
    }

    detailBusy = true;
    try {
      conn.reducers.advanceDeliveryNote({
        id: selectedDn.id,
        newStatus: { tag: newStatus } as any,
        receiverName: dnAdvanceForm.receiverName.trim() || undefined,
        notes: dnAdvanceForm.notes.trim() || undefined
      });
      toast.success(`Delivery note marked ${statusLabel(newStatus).toLowerCase()}.`);
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to update delivery note status.';
    } finally {
      detailBusy = false;
    }
  }

  async function submitGrnItem() {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedGrn) return;

    const quantityReceived = parseWholeQuantity(grnItemForm.quantityReceived);
    const quantityAccepted = parseWholeQuantity(grnItemForm.quantityAccepted);
    if (!grnItemForm.lineItemId || quantityReceived === null || quantityAccepted === null || quantityReceived === 0n) {
      detailError = 'Select a PO line item and enter received and accepted quantities.';
      return;
    }

    detailBusy = true;
    try {
      conn.reducers.addGrnItem({
        grnId: selectedGrn.id,
        lineItemId: BigInt(grnItemForm.lineItemId),
        quantityReceived,
        quantityAccepted,
        notes: grnItemForm.notes.trim()
      });
      grnItemForm = { lineItemId: '', quantityReceived: '', quantityAccepted: '', notes: '' };
      toast.success('GRN item added.');
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to add GRN item.';
    } finally {
      detailBusy = false;
    }
  }

  async function advanceGrn(newStatus: 'Inspecting' | 'Accepted' | 'Rejected') {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedGrn) return;

    detailBusy = true;
    try {
      conn.reducers.advanceGrn({
        id: selectedGrn.id,
        newStatus: { tag: newStatus } as any,
        inspectionNotes: grnAdvanceNotes.trim() || undefined
      });
      toast.success(`GRN marked ${statusLabel(newStatus).toLowerCase()}.`);
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to update GRN status.';
    } finally {
      detailBusy = false;
    }
  }

  async function submitPoLineItem() {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedPo) return;
    if (selectedPo.status.tag !== 'Draft') {
      detailError = 'Line items can only be added while the PO is in Draft.';
      return;
    }

    const quantity = parseWholeQuantity(poLineForm.quantity);
    const unitPriceFils = parseBhdToFils(poLineForm.unitPriceBhd);
    if (!poLineForm.description.trim() || quantity === null || unitPriceFils === null) {
      detailError = 'Description, quantity, and unit price are required.';
      return;
    }

    detailBusy = true;
    try {
      conn.reducers.addLineItem({
        parentType: 'purchase_order',
        parentId: selectedPo.id,
        description: poLineForm.description.trim(),
        quantity,
        unitPriceFils,
        fobCostFils: undefined,
        freightCostFils: undefined,
        customsCostFils: undefined,
        insuranceCostFils: undefined,
        handlingCostFils: undefined,
        financeCostFils: undefined,
        marginBps: undefined,
        costPerUnitFils: undefined
      });

      conn.reducers.managePurchaseOrder({
        id: selectedPo.id,
        partyId: selectedPo.partyId,
        orderId: selectedPo.orderId,
        deliveryTerms: selectedPo.deliveryTerms,
        newStatus: selectedPo.status,
        totalFils: selectedPo.totalFils + quantity * unitPriceFils
      });

      poLineForm = { description: '', quantity: '1', unitPriceBhd: '' };
      toast.success('Purchase order line item added.');
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to add purchase order line item.';
    } finally {
      detailBusy = false;
    }
  }

  async function advancePo(newStatus: 'Active' | 'InProgress' | 'Terminal' | 'Cancelled') {
    detailError = '';
    const conn = getConnection();
    if (!conn || !selectedPo) return;

    detailBusy = true;
    try {
      conn.reducers.managePurchaseOrder({
        id: selectedPo.id,
        partyId: selectedPo.partyId,
        orderId: selectedPo.orderId,
        deliveryTerms: selectedPo.deliveryTerms,
        newStatus: { tag: newStatus } as any,
        totalFils: selectedPo.totalFils
      });
      toast.success(`Purchase order marked ${statusLabel(newStatus).toLowerCase()}.`);
    } catch (err: any) {
      detailError = err?.message ?? 'Failed to update purchase order.';
    } finally {
      detailBusy = false;
    }
  }
</script>

<!-- ─────────────────────────────── TEMPLATE ─────────────────────────────── -->

<div class="ops-page">

  <!-- Header -->
  <header class="ops-header" use:enter={{ index: 0 }}>
    <div class="ops-header-left">
      <p class="page-label">OPERATIONS</p>
      <h1 class="page-title">Operations Hub</h1>
    </div>
    <div class="ops-summary">
      <div class="summary-stat card">
        <span class="summary-label">Active Orders</span>
        <span class="summary-value">{activeOrderCount}</span>
      </div>
      <div class="summary-stat card">
        <span class="summary-label">In Transit</span>
        <span class="summary-value">{inTransitCount}</span>
      </div>
      <div class="summary-stat card">
        <span class="summary-label">Delivered MTD</span>
        <span class="summary-value">{deliveredMtdCount}</span>
      </div>
      {#if activeTab === 'delivery_notes'}
        <button class="btn btn-gold" onclick={openNewDnModal}>New Delivery Note</button>
      {:else if activeTab === 'grns'}
        <button class="btn btn-gold" onclick={openNewGrnModal}>New GRN</button>
      {:else if activeTab === 'pos'}
        <button class="btn btn-gold" onclick={openNewPoModal}>New Purchase Order</button>
      {/if}
    </div>
  </header>

  <!-- Tab Strip -->
  <div class="tab-strip" use:enter={{ index: 1 }}>
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:tab-active={activeTab === tab.id}
        onclick={() => { activeTab = tab.id; }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="tab-content" use:enter={{ index: 2 }}>

    <!-- ── ORDERS TAB ── -->
    {#if activeTab === 'orders'}
      <div class="card table-card">
        <div class="card-header">
          <span class="card-section-title">Orders</span>
          <span class="card-count">{orderRows.length}</span>
        </div>
        {#if orderRows.length === 0}
          <div class="empty-state">
            <div class="empty-abbr">ORD</div>
            <p class="empty-label">No Orders Yet</p>
            <p class="empty-hint">Orders appear when a pipeline is won and converted.</p>
          </div>
        {:else}
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th class="col-num">Value (BHD)</th>
                  <th>Status</th>
                  <th>PO Ref</th>
                  <th>Delivery Date</th>
                </tr>
              </thead>
              <tbody>
                {#each orderRows as row}
                  <tr class="tr-data">
                    <td class="td-mono td-ref">{row.ref}</td>
                    <td class="td-primary">{row.customer}</td>
                    <td class="td-date">{row.createdAt}</td>
                    <td class="td-mono col-num">{row.total}</td>
                    <td>
                      <span class="badge badge-{statusColor(row.status)}">
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td class="td-mono td-ref-sm">{row.poRef}</td>
                    <td class="td-date">{row.expectedDelivery}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

    <!-- ── PURCHASE ORDERS TAB ── -->
    {:else if activeTab === 'pos'}
      <div class="ops-split">
        <div class="card table-card">
          <div class="card-header">
            <span class="card-section-title">Purchase Orders</span>
            <span class="card-count">{poRows.length}</span>
          </div>
          {#if poRows.length === 0}
            <div class="empty-state">
              <div class="empty-abbr">PO</div>
              <p class="empty-label">No Purchase Orders Yet</p>
              <p class="empty-hint">Create a purchase order to start tracking supplier orders.</p>
            </div>
          {:else}
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Supplier</th>
                    <th>Order Ref</th>
                    <th class="col-num">Value (BHD)</th>
                    <th>Status</th>
                    <th>Expected Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {#each poRows as row}
                    <tr
                      class="tr-data tr-clickable"
                      class:tr-selected={selectedPoId === row.id}
                      class:tr-pastdue={row.isPastDue}
                      onclick={() => { selectedPoId = row.id; detailError = ''; }}
                    >
                      <td class="td-mono td-ref">{row.ref}</td>
                      <td class="td-primary">{row.supplier}</td>
                      <td class="td-mono td-ref-sm">{row.orderRef}</td>
                      <td class="td-mono col-num">{row.total}</td>
                      <td>
                        <span class="badge badge-{statusColor(row.status)}">
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td class="td-date" class:td-overdue={row.isPastDue}>{row.expectedDelivery}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- PO Detail Panel -->
        <div class="card detail-card">
          <div class="card-header">
            <span class="card-section-title">PO Detail</span>
            {#if selectedPo}
              <span class="card-count">PO-{String(selectedPo.id).padStart(3, '0')}</span>
            {/if}
          </div>
          {#if !selectedPo}
            <div class="empty-state">
              <div class="empty-abbr">PO</div>
              <p class="empty-label">Select a Purchase Order</p>
              <p class="empty-hint">Click any row to view lines and actions.</p>
            </div>
          {:else}
            <div class="detail-stack">
              <div class="detail-grid">
                <div class="detail-pair">
                  <span class="detail-label">Supplier</span>
                  <span class="detail-value">{partyMap.get(selectedPo.partyId)?.name ?? '-'}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Status</span>
                  <span class="detail-value">
                    <span class="badge badge-{statusColor(selectedPo.status.tag)}">{statusLabel(selectedPo.status.tag)}</span>
                  </span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Linked Order</span>
                  <span class="detail-value">{selectedPo.orderId ? `ORD-${String(selectedPo.orderId).padStart(3, '0')}` : 'Unlinked'}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Delivery Terms</span>
                  <span class="detail-value">{selectedPo.deliveryTerms || '-'}</span>
                </div>
              </div>

              {#if detailError}
                <div class="form-error">{detailError}</div>
              {/if}

              <div class="subpanel">
                <h3 class="subpanel-title">PO Lines</h3>
                {#if selectedPoItems.length === 0}
                  <p class="empty-inline">No line items on this purchase order yet.</p>
                {:else}
                  <div class="table-scroll">
                    <table class="data-table compact">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Qty</th>
                          <th class="col-num">Unit</th>
                          <th class="col-num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each selectedPoItems as item}
                          <tr class="tr-data">
                            <td>{item.description}</td>
                            <td class="td-mono">{item.quantity}</td>
                            <td class="td-mono col-num">{formatBHD(item.unitPriceFils)}</td>
                            <td class="td-mono col-num">{formatBHD(item.totalPriceFils)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>

              {#if selectedPo.status.tag === 'Draft'}
                <div class="subpanel">
                  <h3 class="subpanel-title">Add Draft Line</h3>
                  <div class="form-row">
                    <label class="form-group form-group-wide">
                      <span class="form-label">Description</span>
                      <input class="input" bind:value={poLineForm.description} placeholder="Item description" />
                    </label>
                    <label class="form-group">
                      <span class="form-label">Quantity</span>
                      <input class="input" type="number" min="1" step="1" bind:value={poLineForm.quantity} />
                    </label>
                    <label class="form-group">
                      <span class="form-label">Unit Price (BHD)</span>
                      <input class="input" type="number" min="0" step="0.001" bind:value={poLineForm.unitPriceBhd} />
                    </label>
                  </div>
                  <button class="btn btn-gold" onclick={submitPoLineItem} disabled={detailBusy}>Add PO Line</button>
                </div>
              {/if}

              <div class="subpanel">
                <h3 class="subpanel-title">Status Actions</h3>
                <div class="action-row">
                  {#if selectedPo.status.tag === 'Draft'}
                    <button class="btn btn-gold" onclick={() => advancePo('Active')} disabled={detailBusy}>Activate PO</button>
                    <button class="btn" onclick={() => advancePo('Cancelled')} disabled={detailBusy}>Cancel PO</button>
                  {:else if selectedPo.status.tag === 'Active'}
                    <button class="btn btn-gold" onclick={() => advancePo('InProgress')} disabled={detailBusy}>Start Receiving</button>
                    <button class="btn" onclick={() => advancePo('Cancelled')} disabled={detailBusy}>Cancel PO</button>
                  {:else if selectedPo.status.tag === 'InProgress'}
                    <button class="btn btn-gold" onclick={() => advancePo('Terminal')} disabled={detailBusy}>Complete PO</button>
                  {:else}
                    <span class="detail-note">This purchase order is in its final state.</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

    <!-- ── DELIVERY NOTES TAB ── -->
    {:else if activeTab === 'delivery_notes'}
      <div class="ops-split">
        <div class="card table-card">
          <div class="card-header">
            <span class="card-section-title">Delivery Notes</span>
            <span class="card-count">{dnRows.length}</span>
          </div>
          {#if dnRows.length === 0}
            <div class="empty-state">
              <div class="empty-abbr">DN</div>
              <p class="empty-label">No Delivery Notes Yet</p>
              <p class="empty-hint">Create a delivery note from an active order.</p>
            </div>
          {:else}
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>DN #</th>
                    <th>Customer</th>
                    <th>Order #</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Driver</th>
                    <th>Vehicle</th>
                  </tr>
                </thead>
                <tbody>
                  {#each dnRows as row}
                    <tr
                      class="tr-data tr-clickable"
                      class:tr-selected={selectedDnId === row.id}
                      onclick={() => { selectedDnId = row.id; detailError = ''; }}
                    >
                      <td class="td-mono td-ref">{row.dnNumber}</td>
                      <td class="td-primary">{row.customer}</td>
                      <td class="td-mono td-ref-sm">{row.orderRef}</td>
                      <td class="td-date">{row.deliveryDate}</td>
                      <td>
                        <span class="badge badge-{statusColor(row.status)}">
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td>{row.driverName}</td>
                      <td class="td-mono">{row.vehicleNumber}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- DN Detail Panel -->
        <div class="card detail-card">
          <div class="card-header">
            <span class="card-section-title">DN Detail</span>
            {#if selectedDn}
              <span class="card-count">{selectedDn.dnNumber}</span>
            {/if}
          </div>
          {#if !selectedDn}
            <div class="empty-state">
              <div class="empty-abbr">DN</div>
              <p class="empty-label">Select a Delivery Note</p>
              <p class="empty-hint">Click any row to inspect lines and advance status.</p>
            </div>
          {:else}
            <div class="detail-stack">
              <div class="detail-grid">
                <div class="detail-pair">
                  <span class="detail-label">Order</span>
                  <span class="detail-value">ORD-{String(selectedDn.orderId).padStart(3, '0')}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Status</span>
                  <span class="detail-value">
                    <span class="badge badge-{statusColor(selectedDn.status.tag)}">{statusLabel(selectedDn.status.tag)}</span>
                  </span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Delivery Date</span>
                  <span class="detail-value">{formatDate(selectedDn.deliveryDate)}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Receiver</span>
                  <span class="detail-value">{selectedDn.receiverName || 'Pending signature'}</span>
                </div>
              </div>

              {#if detailError}
                <div class="form-error">{detailError}</div>
              {/if}

              <div class="subpanel">
                <h3 class="subpanel-title">Delivered Items</h3>
                {#if selectedDnItems.length === 0}
                  <p class="empty-inline">No line items recorded on this note yet.</p>
                {:else}
                  <div class="table-scroll">
                    <table class="data-table compact">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Qty</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each selectedDnItems as item}
                          <tr class="tr-data">
                            <td>{item.description}</td>
                            <td class="td-mono">{item.quantityDelivered}</td>
                            <td>{item.notes || '-'}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>

              <div class="subpanel">
                <h3 class="subpanel-title">Add Delivered Line</h3>
                <div class="form-row">
                  <label class="form-group form-group-wide">
                    <span class="form-label">Order Line Item</span>
                    <select class="input select-input" bind:value={dnItemForm.lineItemId}>
                      <option value="">Select line item...</option>
                      {#each selectedDnOrderItems.filter((i) => i.remaining > 0n) as item}
                        <option value={String(item.id)}>{item.description} · remaining {String(item.remaining)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="form-group">
                    <span class="form-label">Quantity Delivered</span>
                    <input class="input" type="number" min="1" step="1" bind:value={dnItemForm.quantity} />
                  </label>
                  <label class="form-group form-group-wide">
                    <span class="form-label">Notes</span>
                    <input class="input" bind:value={dnItemForm.notes} placeholder="Optional" />
                  </label>
                </div>
                <button class="btn btn-gold" onclick={submitDnItem} disabled={detailBusy}>Add Delivery Line</button>
              </div>

              <div class="subpanel">
                <h3 class="subpanel-title">Status Actions</h3>
                <div class="form-row">
                  <label class="form-group">
                    <span class="form-label">Receiver Name</span>
                    <input class="input" bind:value={dnAdvanceForm.receiverName} placeholder="Required for Delivered" />
                  </label>
                  <label class="form-group form-group-wide">
                    <span class="form-label">Notes</span>
                    <input class="input" bind:value={dnAdvanceForm.notes} placeholder="Dispatch or delivery notes" />
                  </label>
                </div>
                <div class="action-row">
                  {#if selectedDn.status.tag === 'Draft'}
                    <button class="btn btn-gold" onclick={() => advanceDn('Dispatched')} disabled={detailBusy}>Mark Dispatched</button>
                  {:else if selectedDn.status.tag === 'Dispatched'}
                    <button class="btn btn-gold" onclick={() => advanceDn('Delivered')} disabled={detailBusy}>Mark Delivered</button>
                    <button class="btn" onclick={() => advanceDn('Returned')} disabled={detailBusy}>Mark Returned</button>
                  {:else}
                    <span class="detail-note">This delivery note is in its final state.</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

    <!-- ── GRNs TAB ── -->
    {:else if activeTab === 'grns'}
      <div class="ops-split">
        <div class="card table-card">
          <div class="card-header">
            <span class="card-section-title">Goods Received Notes</span>
            <span class="card-count">{grnRows.length}</span>
          </div>
          {#if grnRows.length === 0}
            <div class="empty-state">
              <div class="empty-abbr">GRN</div>
              <p class="empty-label">No GRNs Yet</p>
              <p class="empty-hint">Create a GRN from an active purchase order.</p>
            </div>
          {:else}
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>GRN #</th>
                    <th>Supplier</th>
                    <th>PO Ref</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {#each grnRows as row}
                    <tr
                      class="tr-data tr-clickable"
                      class:tr-selected={selectedGrnId === row.id}
                      onclick={() => { selectedGrnId = row.id; detailError = ''; }}
                    >
                      <td class="td-mono td-ref">{row.grnNumber}</td>
                      <td class="td-primary">{row.supplier}</td>
                      <td class="td-mono td-ref-sm">{row.poRef}</td>
                      <td class="td-date">{row.receivedDate}</td>
                      <td>
                        <span class="badge badge-{statusColor(row.status)}">
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td>{row.itemCount}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- GRN Detail Panel -->
        <div class="card detail-card">
          <div class="card-header">
            <span class="card-section-title">GRN Detail</span>
            {#if selectedGrn}
              <span class="card-count">{selectedGrn.grnNumber}</span>
            {/if}
          </div>
          {#if !selectedGrn}
            <div class="empty-state">
              <div class="empty-abbr">GRN</div>
              <p class="empty-label">Select a GRN</p>
              <p class="empty-hint">Click any row to inspect receipt lines and actions.</p>
            </div>
          {:else}
            <div class="detail-stack">
              <div class="detail-grid">
                <div class="detail-pair">
                  <span class="detail-label">Purchase Order</span>
                  <span class="detail-value">PO-{String(selectedGrn.purchaseOrderId).padStart(3, '0')}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Status</span>
                  <span class="detail-value">
                    <span class="badge badge-{statusColor(selectedGrn.status.tag)}">{statusLabel(selectedGrn.status.tag)}</span>
                  </span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Received Date</span>
                  <span class="detail-value">{formatDate(selectedGrn.receivedDate)}</span>
                </div>
                <div class="detail-pair">
                  <span class="detail-label">Received By</span>
                  <span class="detail-value">{$nicknameMap.get(String(selectedGrn.receivedBy)) ?? '-'}</span>
                </div>
              </div>

              {#if detailError}
                <div class="form-error">{detailError}</div>
              {/if}

              <div class="subpanel">
                <h3 class="subpanel-title">Receipt Lines</h3>
                {#if selectedGrnItems.length === 0}
                  <p class="empty-inline">No receipt lines recorded on this GRN yet.</p>
                {:else}
                  <div class="table-scroll">
                    <table class="data-table compact">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Received</th>
                          <th>Accepted</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each selectedGrnItems as item}
                          <tr class="tr-data">
                            <td>{item.description}</td>
                            <td class="td-mono">{item.quantityReceived}</td>
                            <td class="td-mono">{item.quantityAccepted}</td>
                            <td>{item.notes || '-'}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>

              <div class="subpanel">
                <h3 class="subpanel-title">Add Receipt Line</h3>
                <div class="form-row">
                  <label class="form-group form-group-wide">
                    <span class="form-label">PO Line Item</span>
                    <select class="input select-input" bind:value={grnItemForm.lineItemId}>
                      <option value="">Select line item...</option>
                      {#each selectedGrnPoItems.filter((i) => i.remaining > 0n) as item}
                        <option value={String(item.id)}>{item.description} · remaining {String(item.remaining)}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="form-group">
                    <span class="form-label">Received</span>
                    <input class="input" type="number" min="1" step="1" bind:value={grnItemForm.quantityReceived} />
                  </label>
                  <label class="form-group">
                    <span class="form-label">Accepted</span>
                    <input class="input" type="number" min="0" step="1" bind:value={grnItemForm.quantityAccepted} />
                  </label>
                  <label class="form-group form-group-wide">
                    <span class="form-label">Inspection Note</span>
                    <input class="input" bind:value={grnItemForm.notes} placeholder="Optional" />
                  </label>
                </div>
                <button class="btn btn-gold" onclick={submitGrnItem} disabled={detailBusy}>Add GRN Line</button>
              </div>

              <div class="subpanel">
                <h3 class="subpanel-title">Status Actions</h3>
                <label class="form-group">
                  <span class="form-label">Inspection Notes</span>
                  <input class="input" bind:value={grnAdvanceNotes} placeholder="Optional inspection summary" />
                </label>
                <div class="action-row">
                  {#if selectedGrn.status.tag === 'Draft'}
                    <button class="btn btn-gold" onclick={() => advanceGrn('Inspecting')} disabled={detailBusy}>Start Inspection</button>
                  {:else if selectedGrn.status.tag === 'Inspecting'}
                    <button class="btn btn-gold" onclick={() => advanceGrn('Accepted')} disabled={detailBusy}>Accept GRN</button>
                    <button class="btn" onclick={() => advanceGrn('Rejected')} disabled={detailBusy}>Reject GRN</button>
                  {:else}
                    <span class="detail-note">This GRN is in its final state.</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

  </div>
</div>

<!-- ───────────────────────── MODALS ───────────────────────── -->

{#if showNewDnModal}
  <div
    class="modal-backdrop"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="New Delivery Note"
    onkeydown={handleModalKeydown}
  >
    <button type="button" class="modal-overlay" aria-label="Close dialog" onclick={closeAllModals}></button>
    <div class="modal card">
      <div class="modal-header">
        <h2 class="modal-title">Create Delivery Note</h2>
        <button class="btn btn-ghost modal-close" onclick={closeAllModals} aria-label="Close" disabled={submittingDn}>
          &times;
        </button>
      </div>
      <div class="modal-body">
        <label class="form-group">
          <span class="form-label">Order</span>
          <select class="input select-input" bind:value={dnForm.orderId}>
            <option value="">Select order...</option>
            {#each availableDnOrders as order}
              <option value={String(order.id)}>{order.label}</option>
            {/each}
          </select>
        </label>
        <label class="form-group">
          <span class="form-label">Delivery Address</span>
          <input class="input" bind:value={dnForm.deliveryAddress} placeholder="Warehouse / site address" />
        </label>
        <div class="form-row">
          <label class="form-group">
            <span class="form-label">Driver Name</span>
            <input class="input" bind:value={dnForm.driverName} />
          </label>
          <label class="form-group">
            <span class="form-label">Vehicle Number</span>
            <input class="input" bind:value={dnForm.vehicleNumber} placeholder="Optional" />
          </label>
        </div>
        {#if dnError}
          <div class="form-error">{dnError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick={closeAllModals} disabled={submittingDn}>Cancel</button>
        <button class="btn btn-gold" onclick={submitNewDn} disabled={submittingDn}>
          {submittingDn ? 'Creating...' : 'Create Delivery Note'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showNewGrnModal}
  <div
    class="modal-backdrop"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="New GRN"
    onkeydown={handleModalKeydown}
  >
    <button type="button" class="modal-overlay" aria-label="Close dialog" onclick={closeAllModals}></button>
    <div class="modal card">
      <div class="modal-header">
        <h2 class="modal-title">Create Goods Received Note</h2>
        <button class="btn btn-ghost modal-close" onclick={closeAllModals} aria-label="Close" disabled={submittingGrn}>
          &times;
        </button>
      </div>
      <div class="modal-body">
        <label class="form-group">
          <span class="form-label">Purchase Order</span>
          <select class="input select-input" bind:value={grnForm.purchaseOrderId}>
            <option value="">Select purchase order...</option>
            {#each availableGrnPos as po}
              <option value={String(po.id)}>{po.label}</option>
            {/each}
          </select>
        </label>
        <label class="form-group">
          <span class="form-label">Received Date</span>
          <input class="input" type="date" bind:value={grnForm.receivedDate} />
        </label>
        <label class="form-group">
          <span class="form-label">Inspection Notes</span>
          <input class="input" bind:value={grnForm.inspectionNotes} placeholder="Optional receiving notes" />
        </label>
        {#if grnError}
          <div class="form-error">{grnError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick={closeAllModals} disabled={submittingGrn}>Cancel</button>
        <button class="btn btn-gold" onclick={submitNewGrn} disabled={submittingGrn}>
          {submittingGrn ? 'Creating...' : 'Create GRN'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showNewPoModal}
  <div
    class="modal-backdrop"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="New Purchase Order"
    onkeydown={handleModalKeydown}
  >
    <button type="button" class="modal-overlay" aria-label="Close dialog" onclick={closeAllModals}></button>
    <div class="modal modal-wide card">
      <div class="modal-header">
        <h2 class="modal-title">Create Purchase Order</h2>
        <button class="btn btn-ghost modal-close" onclick={closeAllModals} aria-label="Close" disabled={submittingPo}>
          &times;
        </button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label class="form-group">
            <span class="form-label">Supplier</span>
            <select class="input select-input" bind:value={poForm.partyId}>
              <option value="">Select supplier...</option>
              {#each supplierParties as supplier}
                <option value={String(supplier.id)}>{supplier.name}</option>
              {/each}
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Delivery Terms</span>
            <input class="input" bind:value={poForm.deliveryTerms} placeholder="CIF Bahrain unless otherwise specified" />
          </label>
          <label class="form-group">
            <span class="form-label">Linked Order</span>
            <select class="input select-input" bind:value={poForm.orderId}>
              <option value="">Optional</option>
              {#each availableOrderOptions as order}
                <option value={String(order.id)}>{order.label}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="composer">
          <div class="composer-header">
            <p class="subpanel-title">Line Items</p>
            <button class="btn btn-ghost" onclick={addDraftPoItem}>Add Row</button>
          </div>
          {#each poDraftItems as item}
            <div class="composer-row">
              <input
                class="input"
                placeholder="Description"
                value={item.description}
                oninput={(e) => updateDraftPoItem(item.clientId, 'description', (e.target as HTMLInputElement).value)}
              />
              <input
                class="input composer-qty"
                type="number"
                min="1"
                step="1"
                value={item.quantity}
                oninput={(e) => updateDraftPoItem(item.clientId, 'quantity', (e.target as HTMLInputElement).value)}
              />
              <input
                class="input"
                type="number"
                min="0"
                step="0.001"
                placeholder="Unit price (BHD)"
                value={item.unitPriceBhd}
                oninput={(e) => updateDraftPoItem(item.clientId, 'unitPriceBhd', (e.target as HTMLInputElement).value)}
              />
              <span class="composer-total">{formatBHD(totalDraftItemFils(item))}</span>
              <button
                class="btn btn-ghost"
                onclick={() => removeDraftPoItem(item.clientId)}
                disabled={poDraftItems.length === 1}
              >
                Remove
              </button>
            </div>
          {/each}
          <div class="composer-footer">
            <span class="form-label">Draft Total</span>
            <span class="composer-grand">{formatBHD(poDraftItems.reduce((s, i) => s + totalDraftItemFils(i), 0n))}</span>
          </div>
        </div>

        {#if poError}
          <div class="form-error">{poError}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick={closeAllModals} disabled={submittingPo}>Cancel</button>
        <button class="btn btn-gold" onclick={submitNewPo} disabled={submittingPo}>
          {submittingPo ? 'Creating...' : 'Create Purchase Order'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ─────────────────────────────── STYLES ────────────────────────────────── -->

<style>
  /* ── Page shell ── */
  .ops-page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-21);
    padding: var(--sp-21) var(--sp-24);
    max-width: 1440px;
    margin: 0 auto;
  }

  /* ── Header ── */
  .ops-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-16);
    flex-wrap: wrap;
  }

  .page-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink-30);
    margin: 0 0 var(--sp-3);
  }

  .page-title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
    line-height: 1;
  }

  .ops-summary {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  .summary-stat {
    padding: var(--sp-8) var(--sp-13);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-width: 110px;
  }

  .summary-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .summary-value {
    font-family: var(--font-data);
    font-size: var(--text-xl);
    font-weight: 300;
    color: var(--ink);
    line-height: 1;
    letter-spacing: -0.02em;
  }

  /* ── Tab strip ── */
  .tab-strip {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    padding: var(--sp-5);
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-subtle);
    border-radius: var(--radius-xl);
    width: fit-content;
  }

  .tab-btn {
    padding: var(--sp-8) var(--sp-16);
    border: none;
    border-radius: var(--radius-pill);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--ink-40);
    background: transparent;
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
    white-space: nowrap;
  }

  .tab-btn:hover {
    color: var(--ink);
    background: var(--ink-06);
  }

  .tab-active {
    background: var(--paper-card);
    box-shadow: var(--shadow-neu-btn);
    color: var(--ink);
    font-weight: 600;
  }

  /* ── Card ── */
  .card {
    background: var(--paper-card);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-neu-raised);
    overflow: hidden;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
    background: var(--paper-elevated);
  }

  .card-section-title {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink);
    flex: 1;
  }

  .card-count {
    font-family: var(--font-data);
    font-size: var(--text-xs);
    color: var(--ink-60);
    background: var(--ink-06);
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
  }

  /* ── Split layout ── */
  .ops-split {
    display: grid;
    grid-template-columns: 1fr 420px;
    gap: var(--sp-16);
    align-items: start;
  }

  @media (max-width: 1024px) {
    .ops-split {
      grid-template-columns: 1fr;
    }
  }

  .table-card {
    min-width: 0;
  }

  .detail-card {
    position: sticky;
    top: var(--sp-21);
  }

  /* ── Table ── */
  .table-scroll {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
  }

  .data-table th {
    padding: var(--sp-8) var(--sp-13);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
    text-align: left;
    border-bottom: 1px solid var(--ink-06);
    white-space: nowrap;
    background: var(--paper-elevated);
  }

  .data-table td {
    padding: var(--sp-8) var(--sp-13);
    font-size: var(--text-sm);
    color: var(--ink-60);
    border-bottom: 1px solid var(--ink-06);
    white-space: nowrap;
  }

  .data-table.compact td,
  .data-table.compact th {
    padding: var(--sp-5) var(--sp-13);
  }

  .tr-data:last-child td {
    border-bottom: none;
  }

  .tr-clickable {
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .tr-clickable:hover td {
    background: var(--ink-03);
  }

  .tr-selected td {
    background: var(--gold-glow);
  }

  .tr-pastdue td {
    background: var(--coral-soft);
  }

  .col-num {
    text-align: right;
  }

  .td-primary {
    color: var(--ink);
    font-weight: 500;
  }

  .td-mono {
    font-family: var(--font-data);
    letter-spacing: -0.01em;
  }

  .td-ref {
    color: var(--ink);
    font-weight: 600;
    font-size: var(--text-sm);
  }

  .td-ref-sm {
    color: var(--ink-60);
    font-size: var(--text-xs);
  }

  .td-date {
    color: var(--ink-60);
    font-size: var(--text-xs);
  }

  .td-overdue {
    color: var(--coral);
    font-weight: 600;
  }

  /* ── Status badges ── */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: var(--sp-1) var(--sp-8);
    border-radius: var(--radius-pill);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .badge-gold    { background: var(--gold-soft);   color: var(--gold); }
  .badge-sage    { background: var(--sage-soft);   color: var(--sage); }
  .badge-coral   { background: var(--coral-soft);  color: var(--coral); }
  .badge-amber   { background: var(--amber-soft);  color: var(--amber); }
  .badge-neutral,
  .badge-muted   { background: var(--ink-06);      color: var(--ink-60); }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--sp-55) var(--sp-34);
    text-align: center;
    gap: var(--sp-8);
  }

  .empty-abbr {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--ink-12);
    background: var(--ink-06);
    padding: var(--sp-8) var(--sp-13);
    border-radius: var(--radius-sm);
  }

  .empty-label {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--ink-60);
    margin: 0;
  }

  .empty-hint {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-30);
    margin: 0;
    max-width: 280px;
    line-height: 1.6;
  }

  .empty-inline {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--ink-30);
    padding: var(--sp-13) var(--sp-21);
    margin: 0;
  }

  /* ── Detail panel ── */
  .detail-stack {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border-bottom: 1px solid var(--ink-06);
  }

  .detail-pair {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-8) var(--sp-16);
    border-right: 1px solid var(--ink-06);
    border-bottom: 1px solid var(--ink-06);
  }

  .detail-pair:nth-child(even) {
    border-right: none;
  }

  .detail-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-30);
  }

  .detail-value {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: var(--sp-5);
  }

  .detail-note {
    font-family: var(--font-body);
    font-size: var(--text-xs);
    color: var(--ink-30);
    font-style: italic;
  }

  /* ── Subpanel ── */
  .subpanel {
    padding: var(--sp-13) var(--sp-16);
    border-bottom: 1px solid var(--ink-06);
    display: flex;
    flex-direction: column;
    gap: var(--sp-8);
  }

  .subpanel:last-child {
    border-bottom: none;
  }

  .subpanel-title {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-60);
    margin: 0;
  }

  /* ── Forms ── */
  .form-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-8);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    flex: 1;
    min-width: 120px;
  }

  .form-group-wide {
    flex: 2;
  }

  .form-label {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-60);
  }

  .select-input {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%231c1c1c' stroke-opacity='0.4' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-13) center;
    padding-right: var(--sp-34);
    cursor: pointer;
  }

  .form-error {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--coral);
    background: var(--coral-soft);
    border-radius: var(--radius-sm);
    padding: var(--sp-8) var(--sp-13);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    flex-wrap: wrap;
  }

  /* ── PO Composer ── */
  .composer {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-neu-inset);
    overflow: hidden;
    margin-top: var(--sp-8);
  }

  .composer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-8) var(--sp-13);
    background: var(--paper-elevated);
    border-bottom: 1px solid var(--ink-06);
  }

  .composer-row {
    display: flex;
    align-items: center;
    gap: var(--sp-8);
    padding: var(--sp-8) var(--sp-13);
    border-bottom: 1px solid var(--ink-06);
  }

  .composer-row .input {
    flex: 1;
  }

  .composer-qty {
    max-width: 70px;
    flex: 0 0 70px !important;
  }

  .composer-total {
    font-family: var(--font-data);
    font-size: var(--text-sm);
    color: var(--ink);
    min-width: 80px;
    text-align: right;
    flex-shrink: 0;
  }

  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-8) var(--sp-13);
    background: var(--paper-elevated);
  }

  .composer-grand {
    font-family: var(--font-data);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--gold);
    letter-spacing: -0.02em;
  }

  /* ── Modal ── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-21);
  }

  .modal-overlay {
    position: absolute;
    inset: 0;
    background: rgba(42, 39, 34, 0.35);
    border: none;
    cursor: pointer;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 520px;
    max-height: 90dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .modal-wide {
    max-width: 760px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-13) var(--sp-21);
    border-bottom: 1px solid var(--ink-06);
    background: var(--paper-elevated);
    gap: var(--sp-13);
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--ink);
    margin: 0;
  }

  .modal-close {
    font-size: var(--text-lg);
    line-height: 1;
    padding: var(--sp-4) var(--sp-8);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-13);
    padding: var(--sp-16) var(--sp-21);
    flex: 1;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-8);
    padding: var(--sp-13) var(--sp-21);
    border-top: 1px solid var(--ink-06);
    background: var(--paper-elevated);
  }
</style>
