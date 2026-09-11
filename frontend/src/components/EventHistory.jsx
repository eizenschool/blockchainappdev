function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(timestamp) * 1000));
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export default function EventHistory({ entries }) {
  return (
    <section className="panel history-panel" aria-labelledby="history-heading">
      <div className="section-title">
        <div>
          <p className="eyebrow">Immutable audit trail</p>
          <h3 id="history-heading">On-chain event history</h3>
        </div>
        <span className="count-pill">{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <p className="history-empty">Agreement activity will appear here after its first confirmed transaction.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => (
            <li key={entry.key}>
              <span className="history-marker" aria-hidden="true" />
              <div className="history-copy">
                <div>
                  <strong>{entry.title}</strong>
                  <span>Agreement #{entry.agreementId}</span>
                </div>
                <p>{entry.detail}</p>
                <small>
                  {formatDate(entry.timestamp)} · Transaction <code title={entry.transactionHash}>{shortHash(entry.transactionHash)}</code>
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
