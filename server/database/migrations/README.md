# Database migrations

Changes to the tables of existing SolarOps databases, applied in order at startup by
[`../migrations.js`](../migrations.js). New databases get their tables from the models, so every
migration must check before acting: it runs on old databases *and* on new ones.

- File name: `NNNN-what-it-does.js` (e.g. `0001-add-projects-notes.js`), never renamed once released.
- Each one runs in a transaction: pass `transaction` to every query.
- On SQLite, prefer `addColumn` and `createTable`: `changeColumn` and `removeColumn` rebuild the
  table, and dropping it cascades to the rows referencing it.
- Forward only: there is no `down`. Going back to an older version restores the backup taken
  before the migrations (`npm run rollback`).

```js
import { DataTypes } from 'sequelize';

export async function up({ queryInterface, transaction }) {
  const columns = await queryInterface.describeTable('projects', { transaction });

  if (!columns.notes) {
    await queryInterface.addColumn('projects', 'notes', { type: DataTypes.TEXT, allowNull: true }, { transaction });
  }
}
```
