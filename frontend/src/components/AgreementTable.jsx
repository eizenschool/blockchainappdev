import { formatEther } from "ethers";

const STATUS_LABELS = ["Created", "Accepted", "Funded", "Pickup verified", "Completed", "Refunded", "Cancelled"];

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(timestamp) * 1000));
}

export default function AgreementTable({
  agreements,
  filter,
  visibleCount,
  onFilterChange,
  onLoadMore,
  onView,
}) {
  const filtered = agreements.filter(({ agreement }) => {
    const status = Number(agreement.status);
    if (filter === "current") return status <= 3;
    if (filter === "closed") return status >= 4;
    return true;
  });
  const visible = filtered.slice(0, visibleCount);

  return (
    <section className="records-section" aria-labelledby="agreement-records-title">
      <div className="records-heading">
        <div>
          <p className="eyebrow">On-chain records</p>
          <h1 id="agreement-records-title">Agreements</h1>
          <p>Review every agreement connected to this wallet without crowding the active-work screens.</p>
        </div>
        <span className="count-pill">{filtered.length}</span>
      </div>

      <div className="record-filters" role="group" aria-label="Filter agreements by status">
        {[{ id: "current", label: "Current" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }].map(({ id, label }) => (
          <button
            className={filter === id ? "active" : ""}
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => onFilterChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="panel empty-state small-empty">
          <h2>No {filter === "all" ? "" : `${filter} `}agreements</h2>
          <p>Agreements matching this status will appear here.</p>
        </div>
      ) : (
        <div className="agreement-table-wrap panel">
          <table className="agreement-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Medical supply</th>
                <th scope="col">Route</th>
                <th scope="col">Escrow</th>
                <th scope="col">Deadline</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => {
                const { agreement } = record;
                const status = Number(agreement.status);
                return (
                  <tr key={agreement.id.toString()}>
                    <td data-label="ID"><strong>#{agreement.id.toString()}</strong></td>
                    <td data-label="Medical supply">{agreement.cargo}</td>
                    <td data-label="Route">{agreement.origin} <span aria-hidden="true">→</span> {agreement.destination}</td>
                    <td data-label="Escrow">{formatEther(agreement.requiredEscrow)} ETH</td>
                    <td data-label="Deadline">{formatDate(agreement.deadline)}</td>
                    <td data-label="Status"><span className={`status status-${status}`}>{STATUS_LABELS[status]}</span></td>
                    <td data-label="Action"><button className="table-action" type="button" onClick={(event) => onView(record, event.currentTarget)}>View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length < filtered.length && (
        <div className="load-more-row">
          <span>Showing {visible.length} of {filtered.length}</span>
          <button className="button button-secondary" type="button" onClick={onLoadMore}>Load more</button>
        </div>
      )}
    </section>
  );
}
