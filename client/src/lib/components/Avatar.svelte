<script lang="ts">
  let {
    name = '',
    size = 'md' as 'sm' | 'md' | 'lg',
    role = '' as 'admin' | 'manager' | 'sales' | 'operations' | 'accountant' | '',
  } = $props();

  const roleColorMap = {
    admin: 'avatar-admin',
    manager: 'avatar-manager',
    sales: 'avatar-sales',
    operations: 'avatar-operations',
    accountant: 'avatar-accountant',
  };

  const sizeMap = {
    sm: 'avatar-sm',
    md: 'avatar-md',
    lg: 'avatar-lg',
  };

  let initials = $derived(() => {
    if (!name) return '?';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  });

  let colorClass = $derived(roleColorMap[role?.toLowerCase() as keyof typeof roleColorMap] ?? 'avatar-default');
  let sizeClass = $derived(sizeMap[size] ?? 'avatar-md');
</script>

<div
  class="avatar {sizeClass} {colorClass}"
  aria-label="{name}{role ? `, ${role}` : ''}"
  role="img"
  title="{name}{role ? ` (${role})` : ''}"
>
  <span class="avatar-initials" aria-hidden="true">{initials()}</span>
</div>

<style>
  .avatar {
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    user-select: none;
  }

  /* Sizes */
  .avatar-sm {
    width: 28px;
    height: 28px;
  }

  .avatar-md {
    width: 36px;
    height: 36px;
  }

  .avatar-lg {
    width: 48px;
    height: 48px;
  }

  .avatar-initials {
    font-family: var(--font-ui);
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    text-transform: uppercase;
  }

  .avatar-sm .avatar-initials { font-size: 0.6rem; }
  .avatar-md .avatar-initials { font-size: var(--text-xs); }
  .avatar-lg .avatar-initials { font-size: var(--text-sm); }

  /* Role colors */
  .avatar-admin {
    background: var(--gold-soft);
    color: var(--gold);
    border: 1.5px solid var(--gold);
  }

  .avatar-manager {
    background: var(--blue-soft);
    color: var(--blue);
    border: 1.5px solid var(--blue);
  }

  .avatar-sales {
    background: var(--sage-soft);
    color: var(--sage);
    border: 1.5px solid var(--sage);
  }

  .avatar-operations {
    background: var(--amber-soft);
    color: var(--amber);
    border: 1.5px solid var(--amber);
  }

  .avatar-accountant {
    background: var(--coral-soft);
    color: var(--coral);
    border: 1.5px solid var(--coral);
  }

  .avatar-default {
    background: var(--ink-12);
    color: var(--ink-60);
    border: 1.5px solid var(--ink-12);
  }
</style>
