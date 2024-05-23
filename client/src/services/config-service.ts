import { IConfig } from "../types";

export async function getConfig(): Promise<IConfig> {
  const response = await fetch("config.json");
  const config: IConfig = await response.json();
  return config;
}
// 8904 3052 0090 0888 7023 0200 7868 9209
