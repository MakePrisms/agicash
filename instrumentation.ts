// See https://nextjs.org/docs/app/guides/instrumentation

export async function register() {
  console.log(
    'HERE HERE. Register is called. Will register the server side instrumentation.',
  );
  try {
    await import('./app/instrument.server');
    console.log('HERE HERE. Server side instrumentation registered.');
  } catch (error) {
    console.error(
      'HERE HERE. Error registering server side instrumentation:',
      error,
    );
  }
}
