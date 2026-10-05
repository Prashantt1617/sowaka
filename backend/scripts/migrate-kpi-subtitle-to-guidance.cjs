// KPI parameters used to carry a one-line subtitle beside their guidance. The
// subtitle is gone: where the guidance was blank the subtitle becomes it, and
// the field is dropped — on live parameters and on any edit staged for the
// next cycle. Safe to run again; a parameter without the field is skipped.
//
//   node --env-file=.env scripts/migrate-kpi-subtitle-to-guidance.cjs
const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  const parameters = db.collection('kpi_parameters');
  const rows = await parameters
    .find({ $or: [{ subtitle: { $exists: true } }, { 'pendingEdit.subtitle': { $exists: true } }] })
    .toArray();
  let moved = 0;
  for (const row of rows) {
    const set = {};
    const unset = {};
    if (row.subtitle !== undefined) {
      if (!(row.description || '').trim() && (row.subtitle || '').trim()) {
        set.description = row.subtitle.trim();
        moved += 1;
      }
      unset.subtitle = '';
    }
    if (row.pendingEdit && row.pendingEdit.subtitle !== undefined) {
      if (!(row.pendingEdit.description || '').trim() && (row.pendingEdit.subtitle || '').trim()) {
        set['pendingEdit.description'] = row.pendingEdit.subtitle.trim();
      }
      unset['pendingEdit.subtitle'] = '';
    }
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    await parameters.updateOne({ _id: row._id }, update);
  }
  console.log(`parameters touched ${rows.length}; subtitle moved into guidance ${moved}`);
  await client.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
