import { contextBridge, ipcRenderer } from "electron";
import type {
  ServerManagerBridge,
  ServerManagerSnapshot,
} from "../shared/types";

const serverManagerBridge: ServerManagerBridge = {
  load: () => ipcRenderer.invoke("jdc:servers:load"),
  save: (request) => ipcRenderer.invoke("jdc:servers:save", request),
  activate: (serverId) => ipcRenderer.invoke("jdc:servers:activate", serverId),
  remove: (serverId) => ipcRenderer.invoke("jdc:servers:remove", serverId),
  forgetLogin: (serverId) =>
    ipcRenderer.invoke("jdc:servers:forget-login", serverId),
  onChanged: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("jdc:servers:changed", (_event, snapshot: unknown) => {
      if (snapshot && typeof snapshot === "object") {
        callback(snapshot as ServerManagerSnapshot);
      }
    });
  },
};

contextBridge.exposeInMainWorld("serverManagerApi", serverManagerBridge);
