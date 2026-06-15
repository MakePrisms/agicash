/**
 * Sets up background task processing.
 * Background tasks are tasks processed in the background that do not require user interaction.
 * An example of such task is processing paid cashu mint quote to mint the tokens.
 * Should be used only by the user's lead client.
 *
 * All six saga families now run inside the SDK's `sdk.tasks` engine (cashu send
 * quote, both cashu receive sagas, spark receive quote, spark send quote, and
 * cashu send swap); the engine runs them while this client is the leader. This
 * component renders nothing and has no remaining task hooks — it is removed
 * along with the leader-status gating in chunk 4d.
 */
export const TaskProcessor = () => {
  return null;
};
