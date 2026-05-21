/*
 * Promotes the EDS div-table shape into a real <table> so we get semantic
 * tabular markup and free browser behavior (alignment, accessibility).
 *
 * Input:
 *   <div class="table">
 *     <div><div>Header A</div><div>Header B</div></div>   ← row 0 = header
 *     <div><div>cell</div><div>cell</div></div>
 *     ...
 *   </div>
 *
 * Output:
 *   <div class="table">
 *     <table>
 *       <thead><tr><th>Header A</th><th>Header B</th></tr></thead>
 *       <tbody><tr><td>…</td><td>…</td></tr></tbody>
 *     </table>
 *   </div>
 */
export default function decorate(block) {
  const rows = [...block.children].filter((el) => el.tagName === 'DIV');
  if (!rows.length) return;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  rows.forEach((rowEl, idx) => {
    const tr = document.createElement('tr');
    const cells = [...rowEl.children].filter((el) => el.tagName === 'DIV');
    cells.forEach((cellEl) => {
      const cell = document.createElement(idx === 0 ? 'th' : 'td');
      // Move all of the cell's children into the new <th>/<td>
      while (cellEl.firstChild) cell.appendChild(cellEl.firstChild);
      tr.appendChild(cell);
    });
    (idx === 0 ? thead : tbody).appendChild(tr);
  });

  table.appendChild(thead);
  if (tbody.children.length) table.appendChild(tbody);

  block.textContent = '';
  block.appendChild(table);
}
