export function Brand({ compact = false }) {
  return (
    <div className="brand" aria-label="NPI Tracker">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 9.2 14.7 3v8.1L8.9 14.2 3 11.1Z" fill="#0b8f7e" />
        <path d="m15.8 3 12.1 6.2-6 3.4-6.1-3.1Z" fill="#46b7a5" />
        <path d="m9.2 16 5.9-3.3v8.1l-6 3.3-6.1-3.2v-8Z" fill="#1aa08e" />
        <path d="m16.2 13.1 5.8 3.1v7.7l-5.8 3.2-5.9-3.2 5.9-3.3Z" fill="#087f70" />
        <path d="m23.1 14.2 5.8-3.1v8l-5.8 3.2Z" fill="#05655d" />
      </svg>
      {compact ? null : <span>NPI Tracker</span>}
    </div>
  );
}
