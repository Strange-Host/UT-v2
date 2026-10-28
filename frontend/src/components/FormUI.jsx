// The form pieces the original pages each re-typed inline (44 identical <label> lines and 18 identical input class
// strings across Leads, Staff, Products, Payments, Expenses, Couriers and others). Every component here renders exactly
// the markup that used to be written out by hand, so adopting one changes no pixel and no behaviour.
//
// This is the original ("legacy") form style. Settings screens use SettingsUI's Field/inputCls and the restyled pages use
// DataUI; neither is touched here.

const FIELD_CLASS = 'w-full px-3 py-2 rounded-lg border border-line outline-none focus:border-accent';

export function FormLabel({ children }) {
  return <label className="block text-xs font-medium text-text-muted mb-1">{children}</label>;
}

// `spacing` is the bottom margin: 'mb-3' between fields (the default), 'mb-5' above a button row, 'mb-1' when a hint follows.
export function FormInput({ spacing = 'mb-3', ...props }) {
  return <input {...props} className={`${FIELD_CLASS} ${spacing}`} />;
}

export function FormSelect({ spacing = 'mb-3', children, ...props }) {
  return <select {...props} className={`${FIELD_CLASS} ${spacing}`}>{children}</select>;
}

export function FormTextarea({ spacing = 'mb-3', ...props }) {
  return <textarea {...props} className={`${FIELD_CLASS} ${spacing}`} />;
}

// Shows nothing when there is no message, so a form can always render it.
export function ErrorBanner({ children }) {
  if (!children) return null;
  return <div className="mb-3 px-3 py-2 rounded-lg bg-danger-soft text-danger text-sm">{children}</div>;
}
