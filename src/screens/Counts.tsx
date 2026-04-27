import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, selectAllPaged } from '@/lib/supabase';
import { VENUES } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountVenueZone, PurchaseItem } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill, Progress, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { getDefaultZones } from '@/lib/venueMap';

/* ───────────────────────────────────────────────────────────────────────
   Counts — admin counting workspace (v0.17)

   Mirrors every audit-time utility the phone app exposes (counting-app.html)
   so an admin can run an audit end-to-end from the desktop and have changes
   propagate to phones via the same Supabase tables the phone reads:

     - Audit lifecycle: start, switch phase, submit, cancel
     - Zone tabs with add / remove (kount_venue_zones, realtime)
     - Add a count entry (item search → qty → zone → issue chip)
     - Manual / typed entry (no purchase_item_id, free-text name)
     - Inline edit qty / move zone / delete
     - Live entries list grouped by zone, with realtime
     - UPC → item linker (admin-direct approve into upc_mappings)

   What this does NOT do (phone-only by design):
     - Camera barcode scan, photo capture/OCR — admin types the UPC instead.

   Real-time: every write goes to the same Supabase tables the phone subscribes
   to, so a counter on-site sees admin changes in their next render tick.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

type IssueKind = 'none' | 'damaged' | 'no-upc' | 'wrong-shelf' | 'expired' | 'other';

const ISSUE_OPTIONS: Array<{ value: IssueKind; label: string }> = [
  { value: 'none',        label: 'No issue' },
  { value: 'damaged',     label: 'Damaged' },
  { value: 'no-upc',      label: 'No UPC' },
  { value: 'wrong-shelf', label: 'Wrong shelf' },
  { value: 'expired',     label: 'Expired' },
  { value: 'other',       label: 'Other' },
];

const PHASE_NEXT: Record<KountAudit['count_phase'], KountAudit['count_phase'] | null> = {
  count1: 'review',
  review: 'count2',
  count2: 'final',
  final:  null,
};

export function Counts({ user }: Props) {
  const [params, setParams] = useSearchParams();
  const auditParam = params.get('audit');

  const isAdminish = user.role === 'corporate' || user.role === 'manager';

  const [audits, setAudits]       = useState<KountAudit[]>([]);
  const [selectedId, setSelected] = useState<string | null>(auditParam);
  const [showStart, setShowStart] = useState(false);

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (user.role === 'corporate' || user.venueIds === 'all') return true;
    return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
  }), [user]);

  const loadAudits = useCallback(async () => {
    const { data, error } = await supabase
      .from('kount_audits')
      .select('*')
      .in('status', ['active', 'submitted'])
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) { console.error('[counts] load audits', error); return; }
    setAudits(filterVisible((data ?? []) as KountAudit[]));
  }, [filterVisible]);

  useEffect(() => { void loadAudits(); }, [loadAudits]);

  // Deep-link recovery: ?audit=<id> may point to an audit older than the
  // recent-50 cap loadAudits uses — common when clicking through from the
  // Venues card on a long-since-completed audit. Fetch that single row by
  // id and splice it in so the workspace renders instead of silently
  // showing the empty state.
  useEffect(() => {
    if (!auditParam) return;
    if (audits.some(a => a.id === auditParam)) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('kount_audits')
        .select('*')
        .eq('id', auditParam)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        console.warn('[counts] deep-linked audit not found', auditParam, error);
        return;
      }
      const row = data as KountAudit;
      // Respect venue scope so a manager can't view audits from venues they
      // don't have access to via a hand-crafted URL.
      const visible =
        user.role === 'corporate' || user.venueIds === 'all' ||
        (Array.isArray(user.venueIds) && user.venueIds.includes(row.venue_id));
      if (!visible) return;
      setAudits(prev => prev.some(a => a.id === row.id) ? prev : [row, ...prev]);
    })();
    return () => { cancelled = true; };
  }, [auditParam, audits, user]);

  // Live audit list — admin's "Start audit" elsewhere or counter's start needs to land here
  useEffect(() => {
    const ch = supabase
      .channel('counts-audits-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits' }, () => { void loadAudits(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAudits]);

  useEffect(() => {
    if (selectedId && selectedId !== auditParam) setParams({ audit: selectedId }, { replace: true });
  }, [selectedId, auditParam, setParams]);

  const selectedAudit = audits.find(a => a.id === selectedId) ?? null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Counting workspace</div>
          <h1>Counts</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedId ?? ''}
            onChange={e => setSelected(e.target.value || null)}
            style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, minWidth: 280 }}>
            <option value="">Select an audit…</option>
            {audits.map(a => (
              <option key={a.id} value={a.id}>
                {a.join_code} · {a.venue_name} · {a.status === 'submitted' ? 'submitted' : a.count_phase}
              </option>
            ))}
          </select>
          {isAdminish && (
            <Btn variant="primary" size="sm" leading={Ic.plus(14)} onClick={() => setShowStart(true)}>
              Start audit
            </Btn>
          )}
          <Btn variant="secondary" size="sm" onClick={() => void loadAudits()}>Refresh</Btn>
        </div>
      </div>

      <div className="content">
        {!selectedAudit
          ? <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Pick an audit above to start counting, or click “Start audit” to open a fresh one.</div></Card>
          : <CountsWorkspace audit={selectedAudit} user={user} />}
      </div>

      {showStart && isAdminish && (
        <StartAuditModal user={user} onClose={() => setShowStart(false)} onStarted={(id) => { setShowStart(false); setSelected(id); void loadAudits(); }} />
      )}
    </>
  );
}

/* ────────── Per-audit workspace ────────── */

function CountsWorkspace({ audit, user }: { audit: KountAudit; user: AccessEntry }) {
  const isAdminish   = user.role === 'corporate' || user.role === 'manager';
  const isReadOnly   = audit.status !== 'active';

  const [entries, setEntries] = useState<KountEntry[]>([]);
  const [zonesDb, setZonesDb] = useState<KountVenueZone[]>([]);
  const [catalog, setCatalog] = useState<PurchaseItem[]>([]);
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const [currentZone, setCurrentZone] = useState<string>('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const defaultZones = useMemo(() => getDefaultZones(audit.venue_id), [audit.venue_id]);
  const allZones = useMemo(() => {
    // Default zones first (in fixed order), then custom zones in insert order
    const seen = new Set(defaultZones);
    const customs = zonesDb.filter(z => !seen.has(z.zone_name)).map(z => z.zone_name);
    return [...defaultZones, ...customs];
  }, [defaultZones, zonesDb]);

  // ── Loaders ────────────────────────────────────────────────────────
  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from('kount_entries')
      .select('*')
      .eq('audit_id', audit.id)
      .order('timestamp', { ascending: false });
    if (error) { console.error('[counts] load entries', error); return; }
    setEntries((data ?? []) as KountEntry[]);
  }, [audit.id]);

  const loadZones = useCallback(async () => {
    const { data, error } = await supabase
      .from('kount_venue_zones')
      .select('*')
      .eq('venue_id', audit.venue_id)
      .order('added_at', { ascending: true });
    if (error) { console.error('[counts] load zones', error); return; }
    setZonesDb((data ?? []) as KountVenueZone[]);
  }, [audit.venue_id]);

  const loadCatalogAndCarried = useCallback(async () => {
    setLoadingCatalog(true);
    const [cat, carr] = await Promise.all([
      selectAllPaged<PurchaseItem>('purchase_items', 'id,name,brand,category,subcategory,upc,sku', 'name'),
      selectAllPaged<{ purchase_item_id: string }>('kount_carried_items', 'purchase_item_id', 'purchase_item_id'),
    ]);
    setCatalog(cat);
    setCarried(new Set(carr.map(r => r.purchase_item_id)));
    setLoadingCatalog(false);
  }, []);

  useEffect(() => { void loadEntries(); }, [loadEntries]);
  useEffect(() => { void loadZones();   }, [loadZones]);
  useEffect(() => { void loadCatalogAndCarried(); }, [loadCatalogAndCarried]);

  // Default zone selection: first zone with entries, else first default zone
  useEffect(() => {
    if (currentZone) return;
    if (allZones.length === 0) return;
    const counted = new Map<string, number>();
    for (const e of entries) counted.set(e.zone, (counted.get(e.zone) ?? 0) + 1);
    const firstWithCounts = allZones.find(z => (counted.get(z) ?? 0) > 0);
    setCurrentZone(firstWithCounts ?? allZones[0]);
  }, [allZones, entries, currentZone]);

  // ── Realtime ───────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel('counts-entries-' + audit.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_entries', filter: `audit_id=eq.${audit.id}` }, () => { void loadEntries(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [audit.id, loadEntries]);

  useEffect(() => {
    const ch = supabase
      .channel('counts-zones-' + audit.venue_id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_venue_zones', filter: `venue_id=eq.${audit.venue_id}` }, () => { void loadZones(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [audit.venue_id, loadZones]);

  // ── Counts per zone ─────────────────────────────────────────────────
  const countsByZone = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.zone, (map.get(e.zone) ?? 0) + 1);
    return map;
  }, [entries]);

  // ── Orphan zones ────────────────────────────────────────────────────
  // Entries can sit in a zone that was later removed (admin removed a
  // custom zone with rows still in it, or a counter typo'd a zone name
  // pre-v1.20 before zones were Supabase-backed). Without surfacing them
  // explicitly the tabs hide those rows; the entries table's "All zones"
  // filter shows them but the qty rolling up into the wrong-zone bucket
  // is exactly the kind of variance error this app exists to prevent.
  const orphanZones = useMemo(() => {
    const known = new Set(allZones);
    const out: string[] = [];
    for (const z of countsByZone.keys()) {
      if (!known.has(z) && !out.includes(z)) out.push(z);
    }
    return out;
  }, [countsByZone, allZones]);

  // ── Zone CRUD ──────────────────────────────────────────────────────
  const addZone = async () => {
    if (isReadOnly) return;
    const raw = prompt('New zone name (e.g. Back Bar, Main Fridge, VIP):');
    const name = raw?.trim();
    if (!name) return;
    const dupe = allZones.find(z => z.toLowerCase() === name.toLowerCase());
    if (dupe) { alert(`Zone "${dupe}" already exists`); return; }
    const { error } = await supabase.from('kount_venue_zones').insert({
      venue_id: audit.venue_id,
      zone_name: name,
      added_by_email: user.email,
      added_by_name: user.name,
    });
    if (error) { alert('Add zone failed: ' + error.message); return; }
    setCurrentZone(name);
  };

  const restoreOrphanZone = async (zoneName: string) => {
    if (!isAdminish) return;
    const dupe = allZones.find(z => z.toLowerCase() === zoneName.toLowerCase());
    if (dupe) { alert(`Zone "${dupe}" already exists`); return; }
    const { error } = await supabase.from('kount_venue_zones').insert({
      venue_id: audit.venue_id,
      zone_name: zoneName,
      added_by_email: user.email,
      added_by_name: user.name,
    });
    if (error) { alert('Restore zone failed: ' + error.message); return; }
    setCurrentZone(zoneName);
  };

  const reassignOrphanEntries = async (fromZone: string, toZone: string) => {
    if (!isAdminish || isReadOnly) return;
    if (!toZone || fromZone === toZone) return;
    const affected = countsByZone.get(fromZone) ?? 0;
    if (!confirm(`Move all ${affected} entries from "${fromZone}" to "${toZone}"?\n\nEntries can't be split — every row in "${fromZone}" gets the new zone.`)) return;
    const { error } = await supabase
      .from('kount_entries')
      .update({ zone: toZone })
      .eq('audit_id', audit.id)
      .eq('zone', fromZone);
    if (error) { alert('Move entries failed: ' + error.message); return; }
  };

  const removeZone = async (zoneName: string) => {
    if (!isAdminish || isReadOnly) return;
    if (defaultZones.includes(zoneName)) { alert('Default zones cannot be removed'); return; }
    const inUse = countsByZone.get(zoneName) ?? 0;
    const msg = inUse > 0
      ? `Remove zone "${zoneName}"?\n\n${inUse} count entries currently sit in this zone — they stay on the server but will be hidden from the tab list until the zone is re-added.`
      : `Remove zone "${zoneName}"?`;
    if (!confirm(msg)) return;
    const { error } = await supabase
      .from('kount_venue_zones')
      .delete()
      .eq('venue_id', audit.venue_id)
      .eq('zone_name', zoneName);
    if (error) { alert('Remove zone failed: ' + error.message); return; }
    if (currentZone === zoneName) setCurrentZone(defaultZones[0] ?? '');
  };

  // ── Entry CRUD ─────────────────────────────────────────────────────
  const insertEntry = async (payload: {
    item: PurchaseItem | null;
    customName: string;
    qty: number;
    zone: string;
    method: string;
    issue: IssueKind;
    issueNotes: string;
  }) => {
    if (isReadOnly) { alert('Audit is not active'); return; }
    const item = payload.item;
    const itemName = item ? (item.brand ? `${item.brand} — ${item.name}` : item.name) : payload.customName.trim();
    if (!itemName) { alert('Item name required'); return; }
    if (!payload.zone) { alert('Pick a zone first'); return; }

    // is_recount: false unconditionally to match the phone. The phone's
    // syncEntryToSupabase (counting-app.html:6394) never passes isRecount=true
    // — recounts are tracked separately in the kount_recounts table, not by
    // flagging kount_entries rows. Setting is_recount=true here would put
    // admin entries in a different unique-key bucket than phone entries
    // (the merge key is `audit_id, zone, item, is_recount`), so two devices
    // counting the same bottle in the same zone during count2 would create
    // two rows instead of merging.
    const row = {
      audit_id:         audit.id,
      item_id:          item?.id ?? null,
      item_name:        itemName,
      category:         item?.category ?? null,
      qty:              payload.qty,
      zone:             payload.zone,
      method:           payload.method,
      issue:            payload.issue === 'none' ? null : payload.issue,
      issue_notes:      payload.issueNotes.trim() || null,
      sku:              item?.sku ?? null,
      upc:              item?.upc ?? null,
      counted_by_email: user.email,
      counted_by_name:  user.name,
      is_recount:       false,
      timestamp:        new Date().toISOString(),
    };
    const { error } = await supabase.from('kount_entries').insert(row);
    if (error) { alert('Add entry failed: ' + error.message); return; }
  };

  const editEntryQty = async (entryId: string, newQty: number) => {
    if (isReadOnly) return;
    if (!Number.isFinite(newQty) || newQty < 0) return;
    const { error } = await supabase.from('kount_entries').update({ qty: newQty }).eq('id', entryId);
    if (error) alert('Update failed: ' + error.message);
  };

  const moveEntryZone = async (entryId: string, zone: string) => {
    if (isReadOnly) return;
    if (!zone) return;
    const { error } = await supabase.from('kount_entries').update({ zone }).eq('id', entryId);
    if (error) alert('Move failed: ' + error.message);
  };

  const deleteEntry = async (entry: KountEntry) => {
    if (!isAdminish || isReadOnly) return;
    if (!confirm(`Delete entry "${entry.item_name}" (qty ${entry.qty})?`)) return;
    const { error } = await supabase.from('kount_entries').delete().eq('id', entry.id);
    if (error) alert('Delete failed: ' + error.message);
  };

  // ── Lifecycle ──────────────────────────────────────────────────────
  const advancePhase = async () => {
    if (!isAdminish || isReadOnly) return;
    const next = PHASE_NEXT[audit.count_phase];
    if (!next) return;
    if (!confirm(`Advance audit to "${next}"? Counters will see the change immediately.`)) return;
    const patch: Partial<KountAudit> = { count_phase: next };
    if (next === 'count2') patch.count1_closed_at = new Date().toISOString();
    if (next === 'final')  patch.count2_closed_at = new Date().toISOString();
    const { error } = await supabase.from('kount_audits').update(patch).eq('id', audit.id);
    if (error) alert('Phase change failed: ' + error.message);
  };

  const submitAudit = async () => {
    if (!isAdminish || isReadOnly) return;
    if (!confirm('Submit this audit as final? Counters will be locked out of further edits.')) return;
    const { error } = await supabase.from('kount_audits').update({
      status: 'submitted',
      completed_at: new Date().toISOString(),
      count_phase: 'final',
    }).eq('id', audit.id);
    if (error) alert('Submit failed: ' + error.message);
  };

  const cancelAudit = async () => {
    if (!isAdminish || isReadOnly) return;
    const itemCount = entries.length;
    const msg = itemCount === 0
      ? 'Cancel this audit? No items have been counted.'
      : `Cancel this audit?\n\n${itemCount} count entries will be discarded. This cannot be undone.`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('kount_audits').update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    }).eq('id', audit.id);
    if (error) alert('Cancel failed: ' + error.message);
  };

  // ── UPC linker ─────────────────────────────────────────────────────
  const linkUpc = async (barcode: string, item: PurchaseItem) => {
    if (!isAdminish) return;
    const norm = barcode.replace(/\D/g, '').replace(/^0+/, '');
    if (!norm) { alert('Enter a barcode (digits only)'); return; }
    const payload = {
      barcode_raw:        barcode,
      barcode_normalized: norm,
      purchase_item_id:   item.id,
      item_name:          item.name,
      item_brand:         item.brand ?? null,
      item_category:      item.category ?? null,
      submitted_by_email: user.email,
      submitted_by_name:  user.name,
      status:             'approved',
      reviewed_by_email:  user.email,
      reviewed_by_name:   user.name,
      reviewed_at:        new Date().toISOString(),
    };
    const { error } = await supabase.from('upc_mappings').insert(payload);
    if (error) { alert('UPC link failed: ' + error.message); return; }
    // Mirror the phone's purchase_items.upc write-back so non-cache lookups work too
    await supabase.from('purchase_items').update({ upc: barcode }).eq('id', item.id);
    alert(`Linked UPC ${barcode} → ${item.name}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AuditHeader
        audit={audit}
        entryCount={entries.length}
        canControl={isAdminish && !isReadOnly}
        onAdvance={advancePhase}
        onSubmit={submitAudit}
        onCancel={cancelAudit}
      />

      <ZoneTabs
        zones={allZones}
        defaultZones={defaultZones}
        countsByZone={countsByZone}
        currentZone={currentZone}
        onSelect={setCurrentZone}
        onAdd={addZone}
        onRemove={removeZone}
        canRemove={isAdminish && !isReadOnly}
        canAdd={!isReadOnly}
      />

      {orphanZones.length > 0 && (
        <OrphanZoneBanner
          orphans={orphanZones}
          countsByZone={countsByZone}
          knownZones={allZones}
          canRestore={isAdminish}
          canReassign={isAdminish && !isReadOnly}
          onRestore={restoreOrphanZone}
          onReassign={reassignOrphanEntries}
        />
      )}

      {!isReadOnly && (
        <AddEntryCard
          catalog={catalog}
          carried={carried}
          loadingCatalog={loadingCatalog}
          zone={currentZone}
          onSubmit={(p) => void insertEntry(p)}
        />
      )}

      <EntriesTable
        entries={entries}
        zones={allZones}
        currentZone={currentZone}
        canEdit={!isReadOnly}
        canDelete={isAdminish && !isReadOnly}
        onEditQty={editEntryQty}
        onMoveZone={moveEntryZone}
        onDelete={deleteEntry}
      />

      {isAdminish && !isReadOnly && (
        <UpcLinkerCard catalog={catalog} loadingCatalog={loadingCatalog} onLink={linkUpc} />
      )}
    </div>
  );
}

/* ────────── Audit header strip ────────── */

function AuditHeader({
  audit, entryCount, canControl, onAdvance, onSubmit, onCancel,
}: {
  audit: KountAudit;
  entryCount: number;
  canControl: boolean;
  onAdvance: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const phaseLabel = audit.status === 'submitted' ? 'submitted' : audit.count_phase;
  const phaseTone = audit.status === 'submitted' ? 'positive'
                  : audit.count_phase === 'count1' ? 'gold'
                  : audit.count_phase === 'review' ? 'inform'
                  : audit.count_phase === 'count2' ? 'caution'
                  : 'positive';
  const next = PHASE_NEXT[audit.count_phase];
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Eyebrow>Active audit</Eyebrow>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{audit.venue_name}</div>
            <Pill tone={phaseTone} size="sm">{phaseLabel}</Pill>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-muted)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-bg)', letterSpacing: 2, marginRight: 8 }}>
              {audit.join_code}
            </span>
            started {new Date(audit.started_at).toLocaleString()} by {audit.started_by_name || audit.started_by_email}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>{entryCount} count entries</div>
            <Progress value={Math.min(entryCount, 500)} total={500} tone="ink" height={6} />
          </div>
        </div>

        {canControl && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {next && (
              <Btn variant="secondary" size="sm" onClick={onAdvance}>
                Advance to {next}
              </Btn>
            )}
            <Btn variant="primary" size="sm" leading={Ic.checkCircle(14)} onClick={onSubmit}>
              Submit final
            </Btn>
            <Btn variant="critical" size="sm" leading={Ic.close(14)} onClick={onCancel}>
              Cancel audit
            </Btn>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ────────── Orphan zone banner ────────── */

function OrphanZoneBanner({
  orphans, countsByZone, knownZones, canRestore, canReassign, onRestore, onReassign,
}: {
  orphans: string[];
  countsByZone: Map<string, number>;
  knownZones: string[];
  canRestore: boolean;
  canReassign: boolean;
  onRestore: (z: string) => Promise<void> | void;
  onReassign: (from: string, to: string) => Promise<void> | void;
}) {
  return (
    <Card padding={14} style={{ borderColor: 'var(--copper-300)', background: 'var(--copper-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Pill tone="caution" size="sm">{orphans.length} orphan zone{orphans.length === 1 ? '' : 's'}</Pill>
        <Eyebrow style={{ color: 'var(--copper-400)' }}>Entries reference zones not in the tab list</Eyebrow>
      </div>
      <div style={{ fontSize: 12, color: 'var(--copper-400)', marginBottom: 10 }}>
        These entries are still in the data and will roll into AVT variance — but they can't be edited from a tab. Restore the zone to bring it back to the tab list, or move the entries into an existing zone.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orphans.map(z => (
          <OrphanRow
            key={z}
            zone={z}
            count={countsByZone.get(z) ?? 0}
            knownZones={knownZones}
            canRestore={canRestore}
            canReassign={canReassign}
            onRestore={() => onRestore(z)}
            onReassign={(to) => onReassign(z, to)}
          />
        ))}
      </div>
    </Card>
  );
}

function OrphanRow({
  zone, count, knownZones, canRestore, canReassign, onRestore, onReassign,
}: {
  zone: string;
  count: number;
  knownZones: string[];
  canRestore: boolean;
  canReassign: boolean;
  onRestore: () => Promise<void> | void;
  onReassign: (to: string) => Promise<void> | void;
}) {
  const [target, setTarget] = useState<string>('');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      background: '#FFF', border: '1px solid var(--copper-300)', borderRadius: 6,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{zone}</span>
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-muted)' }}>
          {count} {count === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {canRestore && (
        <Btn variant="secondary" size="sm" onClick={() => void onRestore()}>Restore zone</Btn>
      )}
      {canReassign && (
        <>
          <select
            value={target}
            onChange={e => setTarget(e.target.value)}
            style={{ padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12, background: '#FFF' }}
          >
            <option value="">Move to…</option>
            {knownZones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <Btn variant="primary" size="sm" disabled={!target} onClick={() => target && void onReassign(target)}>
            Move
          </Btn>
        </>
      )}
    </div>
  );
}

/* ────────── Zone tabs ────────── */

function ZoneTabs({
  zones, defaultZones, countsByZone, currentZone, onSelect, onAdd, onRemove, canAdd, canRemove,
}: {
  zones: string[];
  defaultZones: string[];
  countsByZone: Map<string, number>;
  currentZone: string;
  onSelect: (z: string) => void;
  onAdd: () => void;
  onRemove: (z: string) => void;
  canAdd: boolean;
  canRemove: boolean;
}) {
  const defaults = new Set(defaultZones);
  return (
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {zones.map(z => {
          const count = countsByZone.get(z) ?? 0;
          const active = z === currentZone;
          const isCustom = !defaults.has(z);
          return (
            <span
              key={z}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                background: active ? 'var(--dark-900)' : '#FFF',
                color: active ? 'var(--off-100)' : 'var(--fg-primary)',
                border: '1px solid ' + (active ? 'var(--dark-900)' : 'var(--border-strong)'),
                fontSize: 13, fontWeight: 600,
              }}
              onClick={() => onSelect(z)}
            >
              {z}
              <span style={{
                fontSize: 11, fontWeight: 700,
                padding: '1px 7px', borderRadius: 9999,
                background: active ? 'rgba(255,255,255,.18)' : 'var(--off-200)',
                color: active ? 'var(--off-100)' : 'var(--fg-muted)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>{count}</span>
              {canRemove && isCustom && (
                <span
                  onClick={(e) => { e.stopPropagation(); onRemove(z); }}
                  title="Remove zone"
                  style={{
                    marginLeft: 2, width: 16, height: 16, borderRadius: 9999,
                    display: 'grid', placeItems: 'center', cursor: 'pointer',
                    background: active ? 'rgba(255,255,255,.18)' : 'var(--off-200)',
                    color: active ? 'var(--off-100)' : 'var(--fg-muted)',
                    fontSize: 12, lineHeight: 1,
                  }}
                >×</span>
              )}
            </span>
          );
        })}
        {canAdd && (
          <button
            onClick={onAdd}
            style={{
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
              background: '#FFF', color: 'var(--accent-bg)',
              border: '1px dashed var(--accent-bg)',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >+ Zone</button>
        )}
      </div>
    </Card>
  );
}

/* ────────── Add-entry card ────────── */

function AddEntryCard({
  catalog, carried, loadingCatalog, zone, onSubmit,
}: {
  catalog: PurchaseItem[];
  carried: Set<string>;
  loadingCatalog: boolean;
  zone: string;
  onSubmit: (p: { item: PurchaseItem | null; customName: string; qty: number; zone: string; method: string; issue: IssueKind; issueNotes: string }) => void;
}) {
  const [mode, setMode] = useState<'search' | 'manual' | 'upc'>('search');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PurchaseItem | null>(null);
  const [customName, setCustomName] = useState('');
  const [qty, setQty] = useState('1');
  const [issue, setIssue] = useState<IssueKind>('none');
  const [issueNotes, setIssueNotes] = useState('');
  const [upcInput, setUpcInput] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    function match(item: PurchaseItem) {
      const hay = (`${item.name} ${item.brand ?? ''} ${item.sku ?? ''} ${item.upc ?? ''} ${item.subcategory ?? ''}`).toLowerCase();
      return words.every(w => hay.includes(w));
    }
    // Phone behaviour: prefer carried subset; fall back to full catalog if none match
    const useCarried = carried.size > 0;
    const out: PurchaseItem[] = [];
    if (useCarried) {
      for (const it of catalog) {
        if (out.length >= 12) break;
        if (carried.has(it.id) && match(it)) out.push(it);
      }
      if (out.length > 0) return out;
    }
    for (const it of catalog) {
      if (out.length >= 12) break;
      if (match(it)) out.push(it);
    }
    return out;
  }, [search, catalog, carried]);

  const findByUpc = (raw: string): PurchaseItem | null => {
    const norm = raw.replace(/\D/g, '');
    if (!norm) return null;
    const noZ = norm.replace(/^0+/, '');
    return catalog.find(it => {
      const u = (it.upc ?? '').replace(/\D/g, '');
      if (!u) return false;
      if (u === norm) return true;
      if (u.replace(/^0+/, '') === noZ && noZ.length >= 6) return true;
      if (norm.length >= 8 && u.length >= 8 && (norm.includes(u) || u.includes(norm))) return true;
      return false;
    }) ?? null;
  };

  const reset = () => {
    setPicked(null); setCustomName(''); setQty('1');
    setIssue('none'); setIssueNotes(''); setSearch(''); setUpcInput('');
  };

  const submit = () => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q < 0) { alert('Enter a valid quantity'); return; }
    if (mode === 'search' && !picked) { alert('Pick an item from the suggestions'); return; }
    if (mode === 'manual' && !customName.trim()) { alert('Enter an item name'); return; }
    if (mode === 'upc' && !picked) { alert('Type a UPC that matches the catalog'); return; }
    onSubmit({
      item: picked,
      customName: mode === 'manual' ? customName : '',
      qty: q,
      zone,
      method: mode === 'upc' ? 'barcode' : mode === 'manual' ? 'manual' : 'guided',
      issue,
      issueNotes,
    });
    reset();
  };

  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Eyebrow>Add count entry</Eyebrow>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          → zone: <strong style={{ color: 'var(--fg-primary)' }}>{zone || '(pick a zone)'}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ minWidth: 320 }}>
          <Segment<'search' | 'manual' | 'upc'>
            value={mode}
            onChange={(v) => { setMode(v); reset(); }}
            options={[
              { value: 'search', label: 'Search inventory' },
              { value: 'upc',    label: 'Type UPC' },
              { value: 'manual', label: 'Manual entry' },
            ]}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          {mode === 'search' && (
            <>
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPicked(null); }}
                placeholder={loadingCatalog ? 'Loading catalog…' : 'Search name, brand, SKU…'}
                disabled={loadingCatalog}
                style={inputStyle()}
              />
              {picked && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--teal-300)' }}>
                  ✓ {picked.brand ? `${picked.brand} — ` : ''}{picked.name}
                  <button onClick={() => setPicked(null)} style={linkButton()}> change</button>
                </div>
              )}
              {!picked && matches.length > 0 && (
                <div style={suggestionsStyle()}>
                  {matches.map(it => (
                    <div key={it.id} onClick={() => setPicked(it)} style={suggestionRow()}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {it.brand ? `${it.brand} — ` : ''}{it.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', gap: 6 }}>
                        <span>{it.category ?? 'other'}</span>
                        {it.upc && <><span>·</span><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{it.upc}</span></>}
                        {carried.has(it.id) && <Pill tone="positive" size="sm">carried</Pill>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'upc' && (
            <>
              <input
                value={upcInput}
                onChange={e => {
                  const v = e.target.value;
                  setUpcInput(v);
                  setPicked(findByUpc(v));
                }}
                placeholder="Type or paste UPC digits"
                style={{ ...inputStyle(), fontFamily: 'JetBrains Mono, monospace' }}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: picked ? 'var(--teal-300)' : 'var(--fg-muted)' }}>
                {picked
                  ? `✓ ${picked.brand ? picked.brand + ' — ' : ''}${picked.name}`
                  : upcInput
                    ? 'No catalog item matches this UPC. Use Manual entry, or link the UPC below.'
                    : 'Catalog is matched by exact / leading-zero-stripped digits.'}
              </div>
            </>
          )}

          {mode === 'manual' && (
            <input
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="Type a free-text item name"
              style={inputStyle()}
            />
          )}
        </div>

        <input
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          step="0.25"
          min="0"
          placeholder="Qty"
          style={inputStyle()}
        />

        <select
          value={issue}
          onChange={e => setIssue(e.target.value as IssueKind)}
          style={inputStyle()}
        >
          {ISSUE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {issue !== 'none' && (
        <input
          value={issueNotes}
          onChange={e => setIssueNotes(e.target.value)}
          placeholder="Issue notes (optional)…"
          style={{ ...inputStyle(), marginTop: 10 }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" size="sm" onClick={reset}>Reset</Btn>
        <Btn variant="primary" size="sm" leading={Ic.plus(14)} onClick={submit} disabled={!zone}>
          Add to {zone || 'zone'}
        </Btn>
      </div>
    </Card>
  );
}

/* ────────── Entries table ────────── */

function EntriesTable({
  entries, zones, currentZone, canEdit, canDelete, onEditQty, onMoveZone, onDelete,
}: {
  entries: KountEntry[];
  zones: string[];
  currentZone: string;
  canEdit: boolean;
  canDelete: boolean;
  onEditQty: (id: string, qty: number) => Promise<void>;
  onMoveZone: (id: string, zone: string) => Promise<void>;
  onDelete: (e: KountEntry) => Promise<void>;
}) {
  type Filter = 'zone' | 'all' | 'flagged';
  const [filter, setFilter] = useState<Filter>('zone');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (filter === 'zone'    && e.zone !== currentZone) return false;
      if (filter === 'flagged' && !e.issue) return false;
      if (q && !(e.item_name + ' ' + (e.counted_by_name ?? '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, filter, currentZone, search]);

  return (
    <Card padding={0}>
      <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Eyebrow>Entries</Eyebrow>
        <div style={{ minWidth: 320 }}>
          <Segment<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'zone',    label: `${currentZone || 'Zone'} only` },
              { value: 'all',     label: 'All zones' },
              { value: 'flagged', label: 'Flagged' },
            ]}
          />
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search item / counter…"
          style={{ ...inputStyle(), flex: 1, minWidth: 220 }}
        />
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{filtered.length} row{filtered.length === 1 ? '' : 's'}</span>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--fg-muted)' }}>No entries match.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 14px' }}>Item</th>
              <th style={{ padding: '8px 14px', width: 110 }}>Zone</th>
              <th style={{ padding: '8px 14px', width: 90 }}>Qty</th>
              <th style={{ padding: '8px 14px', width: 80 }}>Method</th>
              <th style={{ padding: '8px 14px', width: 130 }}>Counter</th>
              <th style={{ padding: '8px 14px', width: 130 }}>Time</th>
              <th style={{ padding: '8px 14px', width: 110 }}>Issue</th>
              {canDelete && <th style={{ padding: '8px 14px', width: 50 }} />}
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <EntryRow
                key={e.id}
                entry={e}
                zones={zones}
                canEdit={canEdit}
                canDelete={canDelete}
                onEditQty={onEditQty}
                onMoveZone={onMoveZone}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function EntryRow({
  entry, zones, canEdit, canDelete, onEditQty, onMoveZone, onDelete,
}: {
  entry: KountEntry;
  zones: string[];
  canEdit: boolean;
  canDelete: boolean;
  onEditQty: (id: string, qty: number) => Promise<void>;
  onMoveZone: (id: string, zone: string) => Promise<void>;
  onDelete: (e: KountEntry) => Promise<void>;
}) {
  const [qtyDraft, setQtyDraft] = useState<string>('');
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (!editing) setQtyDraft(String(entry.qty)); }, [entry.qty, editing]);

  const commit = async () => {
    const v = Number(qtyDraft);
    setEditing(false);
    if (!Number.isFinite(v)) { setQtyDraft(String(entry.qty)); return; }
    if (v === entry.qty) return;
    await onEditQty(entry.id, v);
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: entry.issue ? 'var(--copper-100)' : undefined }}>
      <td style={{ padding: '8px 14px', fontWeight: 500 }}>{entry.item_name}</td>
      <td style={{ padding: '8px 14px' }}>
        {canEdit ? (
          <select
            value={entry.zone}
            onChange={e => void onMoveZone(entry.id, e.target.value)}
            style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', background: '#FFF' }}>
            {!zones.includes(entry.zone) && <option value={entry.zone}>{entry.zone} (orphan)</option>}
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        ) : entry.zone}
      </td>
      <td style={{ padding: '8px 14px', fontFamily: 'JetBrains Mono, monospace' }}>
        {canEdit ? (
          <input
            type="number" step="0.25" min="0"
            value={qtyDraft}
            onFocus={() => setEditing(true)}
            onChange={e => setQtyDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ width: 70, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
          />
        ) : Number(entry.qty).toFixed(Number.isInteger(entry.qty) ? 0 : 1)}
      </td>
      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--fg-muted)' }}>{entry.method ?? '—'}</td>
      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--fg-muted)' }}>{entry.counted_by_name || entry.counted_by_email}</td>
      <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--fg-muted)' }}>{new Date(entry.timestamp).toLocaleTimeString()}</td>
      <td style={{ padding: '8px 14px' }}>
        {entry.issue
          ? <Pill tone={entry.issue_resolved ? 'positive' : 'caution'} size="sm">{entry.issue}</Pill>
          : <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>—</span>}
      </td>
      {canDelete && (
        <td style={{ padding: '8px 14px', textAlign: 'right' }}>
          <button
            onClick={() => void onDelete(entry)}
            title="Delete entry"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--raspberry-300)', padding: 4 }}
          >{Ic.close(14)}</button>
        </td>
      )}
    </tr>
  );
}

/* ────────── UPC linker (admin-direct approve) ────────── */

function UpcLinkerCard({
  catalog, loadingCatalog, onLink,
}: {
  catalog: PurchaseItem[];
  loadingCatalog: boolean;
  onLink: (barcode: string, item: PurchaseItem) => Promise<void>;
}) {
  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PurchaseItem | null>(null);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    const out: PurchaseItem[] = [];
    for (const it of catalog) {
      if (out.length >= 8) break;
      const hay = (`${it.name} ${it.brand ?? ''} ${it.sku ?? ''} ${it.upc ?? ''}`).toLowerCase();
      if (words.every(w => hay.includes(w))) out.push(it);
    }
    return out;
  }, [search, catalog]);

  const submit = async () => {
    if (!barcode.trim() || !picked) { alert('Enter a barcode and pick an item'); return; }
    await onLink(barcode.trim(), picked);
    setBarcode(''); setSearch(''); setPicked(null);
  };

  return (
    <Card padding={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Eyebrow>Link UPC to item</Eyebrow>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Admin-direct approve · writes to upc_mappings + purchase_items.upc</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, alignItems: 'flex-start' }}>
        <input
          value={barcode}
          onChange={e => setBarcode(e.target.value)}
          placeholder="Barcode digits"
          style={{ ...inputStyle(), fontFamily: 'JetBrains Mono, monospace' }}
        />
        <div style={{ position: 'relative' }}>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPicked(null); }}
            placeholder={loadingCatalog ? 'Loading catalog…' : 'Search item to link…'}
            disabled={loadingCatalog}
            style={inputStyle()}
          />
          {picked && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--teal-300)' }}>
              ✓ {picked.brand ? `${picked.brand} — ` : ''}{picked.name}
              <button onClick={() => setPicked(null)} style={linkButton()}> change</button>
            </div>
          )}
          {!picked && matches.length > 0 && (
            <div style={suggestionsStyle()}>
              {matches.map(it => (
                <div key={it.id} onClick={() => setPicked(it)} style={suggestionRow()}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{it.brand ? `${it.brand} — ` : ''}{it.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {it.category ?? 'other'}
                    {it.upc && <> · existing UPC: <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{it.upc}</span></>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Btn variant="primary" size="sm" leading={Ic.check(14)} onClick={submit} disabled={!barcode.trim() || !picked}>
          Link
        </Btn>
      </div>
    </Card>
  );
}

/* ────────── Start audit modal ────────── */

function StartAuditModal({
  user, onClose, onStarted,
}: {
  user: AccessEntry;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const visibleVenues = useMemo(() => {
    if (user.role === 'corporate' || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [venueId, setVenueId] = useState(visibleVenues[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const start = async () => {
    setErr(null); setBusy(true);
    try {
      const venue = VENUES.find(v => v.id === venueId);
      if (!venue) throw new Error('Pick a venue');

      // Reuse the same RPC the phone uses so codes stay collision-safe
      const { data: codeData, error: rpcErr } = await supabase.rpc('generate_kount_join_code', { p_venue_name: venue.name });
      if (rpcErr || !codeData) throw new Error('Code allocation failed: ' + (rpcErr?.message ?? 'no code'));
      const join_code = String(codeData).replace(/^"|"$/g, '');

      const { data, error } = await supabase
        .from('kount_audits')
        .insert({
          venue_id:         venue.id,
          venue_name:       venue.name,
          status:           'active',
          count_phase:      'count1',
          join_code,
          started_by_email: user.email,
          started_by_name:  user.name,
          started_at:       new Date().toISOString(),
        })
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Insert failed');

      // Add starter as a member (mirrors phone). Fire-and-forget.
      void supabase.from('kount_members').insert({
        audit_id:        (data as KountAudit).id,
        user_email:      user.email,
        user_name:       user.name,
        role:            user.role,
        assigned_zones:  [],
      });

      onStarted((data as KountAudit).id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'grid', placeItems: 'center', zIndex: 1000,
    }}>
      <div ref={dialogRef} onClick={e => e.stopPropagation()} style={{
        background: '#FFF', borderRadius: 10, padding: 20, width: 'min(420px, 92vw)',
        boxShadow: '0 20px 60px rgba(0,0,0,.25)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Start a new audit</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
          A fresh join code is allocated server-side. Counters can join with that code on their phone.
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Venue</label>
          <select value={venueId} onChange={e => setVenueId(e.target.value)} style={{ ...inputStyle(), marginTop: 6 }}>
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--raspberry-300)', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" size="sm" onClick={start} disabled={busy || !venueId}>{busy ? 'Starting…' : 'Start audit'}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ────────── Tiny shared style helpers ────────── */

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '8px 10px',
    border: '1px solid var(--border-strong)', borderRadius: 6,
    fontFamily: 'inherit', fontSize: 13, background: '#FFF',
  };
}
function suggestionsStyle(): React.CSSProperties {
  return {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
    marginTop: 4, background: '#FFF', border: '1px solid var(--border-strong)',
    borderRadius: 6, maxHeight: 280, overflowY: 'auto',
    boxShadow: '0 8px 20px rgba(0,0,0,.08)',
  };
}
function suggestionRow(): React.CSSProperties {
  return {
    padding: '8px 10px', borderBottom: '1px solid var(--border)',
    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
  };
}
function linkButton(): React.CSSProperties {
  return {
    background: 'transparent', border: 'none', color: 'var(--accent-bg)',
    fontSize: 12, cursor: 'pointer', marginLeft: 4, padding: 0, fontFamily: 'inherit',
  };
}
