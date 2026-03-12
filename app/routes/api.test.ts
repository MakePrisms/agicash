import { agicashDbServer } from '~/features/agicash-db/database.server';

export async function loader() {
  const { data, error } = await agicashDbServer
    .from('test')
    .insert({
      id: crypto.randomUUID(),
      description: `Test record created at ${new Date().toISOString()}`,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, record: data });
}
