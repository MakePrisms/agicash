export type DatabaseChangeHandler = {
  event: string;
  handleEvent: (payload: unknown) => void | Promise<void>;
};
