import { useState } from 'react';
import StatCard from '../components/StatCard';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { leadsApi, staffApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/UIContext';
import Pager, { usePager } from '../components/Pager';
import { fetchAll } from '../api/fetchAll';

import Sheet from '../components/Sheet';
import ConvertLeadSheet from '../components/ConvertLeadSheet';
import { FormLabel, FormInput, FormSelect, FormTextarea, ErrorBanner } from '../components/FormUI';
const SOURCES = ['whatsapp', 'walk_in', 'referral', 'shopify', 'other'];
const STATUS_LABELS = { new: 'New', contacted: 'Contacted', rescheduled: 'Rescheduled', converted: 'Converted', cancelled: 'Cancelled' };
const STATUS_COLORS = {
  new: 'bg-line text-text-muted',
  contacted: 'bg-accent/20 text-accent-ink',
  rescheduled: 'bg-accent/20 text-accent-ink',
  converted: 'bg-success-soft text-success',
  cancelled: 'bg-danger-soft text-danger',
};
// Mirrors the backend state machine — for UI affordance only; the server is the source of truth.
const NEXT_STATUSES = {
  new: ['contacted', 'cancelled'],
  contacted: ['rescheduled', 'converted', 'cancelled'],
  rescheduled: ['contacted', 'converted', 'cancelled'],
  converted: [],
  cancelled: [],
};
const emptyForm = { name: '', phone: '', email: '', source: 'walk_in', notes: '', assigned_staff_id: '' };
const emptyActivity = { type: 'call', content: '' };

export default function Leads() {
  const toast = useToast();
  const { hasRole } = useAuth();
  const canAssign = hasRole('admin', 'manager');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [converting, setConverting] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [activityForm, setActivityForm] = useState(emptyActivity);
  const queryClient = useQueryClient();

  const pager = usePager(25);
  const { data: stats } = useQuery({ queryKey: ['leads', 'stats'], queryFn: () => leadsApi.stats().then((r) => r.data.data) });
  const { data, isLoading } = useQuery({
    queryKey: ['leads', { statusFilter, search, page: pager.page, size: pager.pageSize }],
    queryFn: () => leadsApi.list({ ...pager.params, status: statusFilter || undefined, search: search || undefined }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const leads = data?.data || [];

  const { data: staffList } = useQuery({
    queryKey: ['staff', 'for-assign'],
    queryFn: () => fetchAll(staffApi.list, { status: 'active' }),
    enabled: canAssign,
  });

  const { data: selectedLead } = useQuery({
    queryKey: ['leads', selectedId],
    queryFn: () => leadsApi.getById(selectedId).then((r) => r.data.data),
    enabled: !!selectedId,
  });

  // Matches every query whose key starts with 'leads' (the list, the stats and the open lead), so nothing needs naming twice.
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['leads'] });
  }

  function openCreate() {
    setForm(emptyForm);
    setError('');
    setCreating(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await leadsApi.create({ ...form, assigned_staff_id: form.assigned_staff_id || undefined });
      invalidate();
      setCreating(false);
      setForm(emptyForm);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create lead.'));
    }
  }

  async function handleStatusChange(status) {
    try {
      await leadsApi.changeStatus(selectedId, status, status === 'rescheduled' ? followUpDate : undefined);
      invalidate();
      setFollowUpDate('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not update status.'));
    }
  }

  async function handleAddActivity(e) {
    e.preventDefault();
    if (!activityForm.content) return;
    try {
      await leadsApi.addActivity(selectedId, activityForm);
      queryClient.invalidateQueries({ queryKey: ['leads', selectedId] });
      setActivityForm(emptyActivity);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not add activity.'));
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display font-700 text-2xl">Leads</h1>
          <p className="text-text-muted text-sm mt-1">CRM pipeline for WhatsApp, walk-in, and referral leads.</p>
        </div>
        <button onClick={openCreate}
          className="px-4 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink-soft transition-colors whitespace-nowrap">
          + New lead
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total" value={stats?.total ?? '—'} />
        <StatCard label="New" value={stats?.new ?? '—'} />
        <StatCard label="Contacted" value={stats?.contacted ?? '—'} />
        <StatCard label="Converted" value={stats?.converted ?? '—'} />
        <StatCard label="Cancelled" value={stats?.cancelled ?? '—'} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input value={search} onChange={(e) => { setSearch(e.target.value); pager.reset(); }} placeholder="Search name or phone…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-line outline-none focus:border-accent text-sm" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); pager.reset(); }}
          className="px-3 py-2 rounded-lg border border-line outline-none focus:border-accent text-sm">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden scroll-x">
        <table className="stack-sm w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line text-left text-text-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Assigned to</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>}
            {!isLoading && leads.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">No leads found.</td></tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium whitespace-nowrap">
                  <div>{l.name}</div>
                  <div className="text-xs text-text-muted">{l.phone}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="capitalize">{l.source.replace('_', ' ')}</div>
                  {l.form_name && <div className="text-xs text-text-muted max-w-[200px] truncate">{l.form_name}</div>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{l.assigned_staff_name || '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setSelectedId(l.id)} className="text-xs text-text-muted hover:text-text">Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager pager={pager} data={data} noun="leads" />

      {creating && (
        <NewLeadSheet
          form={form} setForm={setForm} error={error} canAssign={canAssign} staffList={staffList}
          onSubmit={handleCreate} onClose={() => setCreating(false)}
        />
      )}

      {selectedId && selectedLead && (
        <LeadDetailSheet
          lead={selectedLead}
          followUpDate={followUpDate} setFollowUpDate={setFollowUpDate}
          activityForm={activityForm} setActivityForm={setActivityForm}
          onStatusChange={handleStatusChange} onAddActivity={handleAddActivity}
          onConvert={() => setConverting(true)} onClose={() => setSelectedId(null)}
        />
      )}

      {converting && selectedLead && (
        <ConvertLeadSheet
          lead={selectedLead}
          onClose={() => setConverting(false)}
          onConverted={() => queryClient.invalidateQueries({ queryKey: ['leads', selectedId] })}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}

function NewLeadSheet({ form, setForm, error, canAssign, staffList, onSubmit, onClose }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  return (
    <Sheet onClose={onClose} size="sm" as="form" onSubmit={onSubmit}>
      <h2 className="font-display font-700 text-lg mb-4">New lead</h2>
      <ErrorBanner>{error}</ErrorBanner>

      <FormLabel>Name</FormLabel>
      <FormInput required autoFocus value={form.name} onChange={set('name')} />

      <FormLabel>Phone</FormLabel>
      <FormInput required value={form.phone} onChange={set('phone')} placeholder="0712345678" />

      <FormLabel>Email (optional)</FormLabel>
      <FormInput type="email" value={form.email} onChange={set('email')} />

      <FormLabel>Source</FormLabel>
      <FormSelect value={form.source} onChange={set('source')}>
        {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
      </FormSelect>

      {canAssign && (
        <>
          <FormLabel>Assign to (optional)</FormLabel>
          <FormSelect value={form.assigned_staff_id} onChange={set('assigned_staff_id')}>
            <option value="">Unassigned</option>
            {staffList?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FormSelect>
        </>
      )}

      <FormLabel>Notes (optional)</FormLabel>
      <FormTextarea value={form.notes} onChange={set('notes')} rows={2} spacing="mb-5" />

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-sm font-medium">Cancel</button>
        <button type="submit" className="flex-1 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink-soft">Create</button>
      </div>
    </Sheet>
  );
}

function LeadDetailSheet({
  lead, followUpDate, setFollowUpDate, activityForm, setActivityForm, onStatusChange, onAddActivity, onConvert, onClose,
}) {
  const nextStatuses = NEXT_STATUSES[lead.status] || [];
  // 'converted' is reached through "Convert to order" below, so a lead is never marked converted with no order.
  const quickStatuses = nextStatuses.filter((s) => s !== 'rescheduled' && s !== 'converted');
  // A brand-new lead can be converted straight away even though the state machine lists no 'converted' step for it.
  const canConvert = nextStatuses.includes('converted') || lead.status === 'new';
  const productOrForm = lead.interested_product_name || lead.form_name;
  const formSuffix = lead.interested_product_name && lead.form_name && lead.form_name !== lead.interested_product_name ? ` (${lead.form_name})` : '';

  return (
    <Sheet onClose={onClose} size="lg">
      <div className="flex items-start justify-between mb-1">
        <h2 className="font-display font-700 text-lg">{lead.name}</h2>
        <StatusBadge status={lead.status} />
      </div>
      <p className="text-sm text-text-muted mb-3">
        <a href={`tel:${lead.phone}`} className="underline">{lead.phone}</a>
        {lead.email ? ` · ${lead.email}` : ''}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-3">
        {productOrForm && (<>
          <dt className="text-text-muted">Product / form</dt>
          <dd>{productOrForm}{formSuffix}</dd>
        </>)}
        <dt className="text-text-muted">Source</dt>
        <dd className="capitalize">{(lead.source || '').replace('_', ' ')}</dd>
        <dt className="text-text-muted">Assigned to</dt>
        <dd>{lead.assigned_staff_name || 'Unassigned'}</dd>
        <dt className="text-text-muted">Received</dt>
        <dd>{lead.created_at}</dd>
      </dl>

      {lead.notes && (
        <div className="mb-4 rounded-lg bg-paper border border-line px-3 py-2">
          <div className="text-xs font-medium text-text-muted mb-1">Details from the customer</div>
          <p className="text-sm whitespace-pre-line break-words">{lead.notes}</p>
        </div>
      )}

      {nextStatuses.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-text-muted mb-2">Move to</div>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.includes('rescheduled') && (
              <div className="flex gap-1 items-center">
                <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-line text-xs" />
                <button onClick={() => onStatusChange('rescheduled')} disabled={!followUpDate}
                  className="px-3 py-1.5 rounded-lg border border-line text-xs font-medium hover:bg-paper disabled:opacity-40">
                  Reschedule
                </button>
              </div>
            )}
            {quickStatuses.map((s) => (
              <button key={s} onClick={() => onStatusChange(s)}
                className="px-3 py-1.5 rounded-lg border border-line text-xs font-medium hover:bg-paper">
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {canConvert && (
        <button onClick={onConvert}
          className="w-full mb-4 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink-soft">
          Convert to order
        </button>
      )}
      {lead.status === 'converted' && lead.converted_order_id && (
        <p className="mb-4 text-sm text-text-muted">Converted to order #{lead.converted_order_id}.</p>
      )}

      <form onSubmit={onAddActivity} className="mb-4 flex gap-2 flex-wrap">
        <select value={activityForm.type} onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value })}
          className="px-2 py-2 rounded-lg border border-line text-xs">
          <option value="call">Call</option>
          <option value="message">Message</option>
          <option value="meeting">Meeting</option>
          <option value="note">Note</option>
        </select>
        <input value={activityForm.content} onChange={(e) => setActivityForm({ ...activityForm, content: e.target.value })}
          placeholder="Log an activity…"
          className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-line text-xs" />
        <button type="submit" className="px-3 py-2 rounded-lg bg-ink text-white text-xs font-medium">Add</button>
      </form>

      <div className="text-xs font-medium text-text-muted mb-2">Activity</div>
      <div className="space-y-2 mb-2">
        {lead.activities?.length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
        {lead.activities?.map((a) => (
          <div key={a.id} className="text-sm border-l-2 border-line pl-3">
            <div className="text-xs text-text-muted">{a.created_at} · {a.staff_name || 'System'} · <span className="capitalize">{a.type.replace('_', ' ')}</span></div>
            {a.content && <div>{a.content}</div>}
          </div>
        ))}
      </div>

      <button onClick={onClose} className="w-full mt-4 py-2.5 rounded-lg border border-line text-sm font-medium">Close</button>
    </Sheet>
  );
}
