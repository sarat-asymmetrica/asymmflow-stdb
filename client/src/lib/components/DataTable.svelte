<script lang="ts">
  import Spinner from './Spinner.svelte';
  import EmptyState from './EmptyState.svelte';

  type Column = {
    key: string;
    label: string;
    align?: 'left' | 'center' | 'right';
    sortable?: boolean;
    format?: (value: unknown, row: Record<string, unknown>) => string;
    currency?: boolean;
  };

  let {
    columns = [] as Column[],
    data = [] as Record<string, unknown>[],
    onRowClick = undefined,
    loading = false,
    emptyMessage = 'No data to display',
    emptyIcon = '◎',
  } = $props();

  let sortKey = $state('');
  let sortDir = $state('asc'); // 'asc' | 'desc'

  function toggleSort(col: Column) {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = col.key;
      sortDir = 'asc';
    }
  }

  function formatBHD(filsValue: unknown) {
    // filsValue is bigint in fils (1 BHD = 1000 fils)
    if (filsValue === null || filsValue === undefined) return '—';
    const num = Number(filsValue);
    return 'BHD ' + (num / 1000).toFixed(3);
  }

  function cellValue(col: Column, row: Record<string, unknown>) {
    const raw = row[col.key];
    if (col.format) return col.format(raw, row);
    if (col.currency) return formatBHD(raw);
    if (raw === null || raw === undefined) return '—';
    return String(raw);
  }

  let sortedData = $derived.by(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  const skeletonRows = 5;
</script>

<div class="datatable-wrap">
  <div class="datatable-scroll">
    <table class="datatable" aria-busy={loading}>
      <thead>
        <tr>
          {#each columns as col}
            <th
              class="th"
              class:sortable={col.sortable}
              class:sorted={sortKey === col.key}
              style="text-align: {col.align ?? 'left'};"
              onclick={() => toggleSort(col)}
              aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : (col.sortable ? 'none' : undefined)}
              scope="col"
            >
              <span class="th-content">
                {col.label}
                {#if col.sortable}
                  <span class="sort-indicator" aria-hidden="true">
                    {#if sortKey === col.key}
                      {sortDir === 'asc' ? '▲' : '▼'}
                    {:else}
                      <span class="sort-inactive">⇅</span>
                    {/if}
                  </span>
                {/if}
              </span>
            </th>
          {/each}
        </tr>
      </thead>

      <tbody>
        {#if loading}
          {#each { length: skeletonRows } as _, i}
            <tr class="skeleton-row">
              {#each columns as _col}
                <td class="td">
                  <span class="skeleton-cell" style="width: {55 + Math.random() * 35}%"></span>
                </td>
              {/each}
            </tr>
          {/each}
        {:else if sortedData.length === 0}
          <tr>
            <td colspan={columns.length} class="empty-cell">
              <EmptyState icon={emptyIcon} title="Nothing here" message={emptyMessage} />
            </td>
          </tr>
        {:else}
          {#each sortedData as row, rowIdx}
            <tr
              class="tr"
              class:striped={rowIdx % 2 === 1}
              class:clickable={!!onRowClick}
              onclick={() => onRowClick?.(row)}
              onkeydown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
              tabindex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
            >
              {#each columns as col}
                <td
                  class="td"
                  class:td-number={col.currency || col.align === 'right'}
                  style="text-align: {col.align ?? 'left'};"
                >
                  {cellValue(col, row)}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .datatable-wrap {
    border-radius: var(--radius-md);
    border: 1px solid var(--ink-06);
    overflow: hidden;
    background: var(--paper-card);
  }

  .datatable-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .datatable {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
  }

  /* Header */
  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--paper-elevated);
  }

  .th {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-60);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: var(--sp-5) var(--sp-8);
    border-bottom: 1.5px solid var(--ink-12);
    white-space: nowrap;
    user-select: none;
  }

  .th-content {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .th.sortable {
    cursor: pointer;
  }

  .th.sortable:hover {
    color: var(--ink);
  }

  .th.sorted {
    color: var(--gold);
  }

  .sort-indicator {
    font-size: 0.7em;
    color: var(--gold);
  }

  .sort-inactive {
    color: var(--ink-30);
  }

  /* Body rows */
  .tr {
    transition: background-color var(--dur-instant) var(--ease-out);
  }

  .tr.striped {
    background: color-mix(in srgb, var(--ink) 2%, transparent);
  }

  .tr.clickable {
    cursor: pointer;
    outline: none;
  }

  .tr.clickable:hover {
    background: var(--gold-soft) !important;
  }

  .tr.clickable:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -2px;
  }

  .td {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--ink);
    padding: var(--sp-5) var(--sp-8);
    border-bottom: 1px solid var(--ink-06);
    vertical-align: middle;
  }

  .td-number {
    font-family: var(--font-data);
    font-size: var(--text-sm);
  }

  /* Skeleton loading */
  .skeleton-row .td {
    padding: var(--sp-8);
  }

  .skeleton-cell {
    display: inline-block;
    height: 12px;
    border-radius: var(--radius-sm);
    background: linear-gradient(
      90deg,
      var(--ink-06) 25%,
      var(--ink-12) 50%,
      var(--ink-06) 75%
    );
    background-size: 400% 100%;
    animation: shimmer 1.4s ease infinite;
  }

  @keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  .empty-cell {
    padding: var(--sp-21) var(--sp-8);
  }
</style>
