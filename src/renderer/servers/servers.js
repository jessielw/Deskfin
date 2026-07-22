"use strict";

const heading = document.getElementById("heading");
const intro = document.getElementById("intro");
const status = document.getElementById("status");
const serverSection = document.getElementById("server-section");
const serverList = document.getElementById("server-list");
const showAdd = document.getElementById("show-add");
const form = document.getElementById("server-form");
const serverUrl = document.getElementById("server-url");
const cancelEdit = document.getElementById("cancel-edit");
const connect = document.getElementById("connect");
const close = document.getElementById("close");
const version = document.getElementById("version");

let snapshot = null;
let replacingId = null;

function errorMessage(error) {
  return String(error?.message || error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
}

function setStatus(message, kind = "error") {
  status.textContent = message || "";
  status.dataset.kind = message ? kind : "";
}

function setBusy(busy) {
  for (const element of document.querySelectorAll("button, input")) {
    element.disabled = busy;
  }
}

function button(label, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener("click", onClick);
  return element;
}

function beginAdd() {
  replacingId = null;
  serverUrl.value = "";
  connect.textContent = "Connect";
  cancelEdit.hidden = snapshot.servers.length === 0;
  form.hidden = false;
  serverUrl.focus();
}

function beginEdit(server) {
  replacingId = server.id;
  serverUrl.value = server.url;
  connect.textContent = "Save and connect";
  cancelEdit.hidden = false;
  form.hidden = false;
  serverUrl.focus();
  serverUrl.select();
}

function cancelForm() {
  replacingId = null;
  serverUrl.value = "";
  if (snapshot.servers.length > 0) form.hidden = true;
}

async function activate(server) {
  setStatus(`Connecting to ${server.name}...`, "pending");
  setBusy(true);
  try {
    snapshot = await window.serverManagerApi.activate(server.id);
    render();
  } catch (error) {
    setStatus(errorMessage(error));
    setBusy(false);
  }
}

async function remove(server) {
  if (!window.confirm(`Remove ${server.name} from Deskfin?`)) return;
  setStatus("");
  setBusy(true);
  try {
    snapshot = await window.serverManagerApi.remove(server.id);
    replacingId = null;
    render();
  } catch (error) {
    setStatus(errorMessage(error));
    setBusy(false);
  }
}

function renderServers() {
  serverList.replaceChildren();
  for (const server of snapshot.servers) {
    const card = document.createElement("article");
    card.className = "server-card";
    const isActive = server.id === snapshot.activeServerId;
    if (isActive) card.classList.add("active");

    const details = document.createElement("div");
    details.className = "server-details";
    const name = document.createElement("h2");
    name.textContent = server.name;
    const url = document.createElement("p");
    url.className = "server-url";
    url.textContent = server.url;
    details.append(name, url);
    if (server.version) {
      const serverVersion = document.createElement("small");
      serverVersion.className = "server-version";
      serverVersion.textContent = `Jellyfin ${server.version}`;
      details.append(serverVersion);
    }

    const actions = document.createElement("div");
    actions.className = "server-actions";
    actions.append(
      button(isActive ? "Open" : "Connect", "", () => activate(server)),
      button("Edit", "secondary", () => beginEdit(server)),
      button("Remove", "quiet danger", () => remove(server)),
    );
    card.append(details, actions);
    serverList.append(card);
  }
}

function render() {
  const hasServers = snapshot.servers.length > 0;
  heading.textContent = hasServers ? "Jellyfin servers" : "Connect to Jellyfin";
  intro.textContent = hasServers
    ? "Choose a server or add another one. Each server keeps its own Jellyfin login."
    : "Enter the address of the Jellyfin server you want to use.";
  version.textContent = `Deskfin ${snapshot.appVersion}`;
  close.hidden = !snapshot.canClose;
  serverSection.hidden = !hasServers;
  renderServers();

  if (!hasServers) {
    form.hidden = false;
    cancelEdit.hidden = true;
  } else if (!replacingId) {
    form.hidden = true;
  }
  if (snapshot.connectionError) setStatus(snapshot.connectionError);
  else if (snapshot.statusMessage) setStatus(snapshot.statusMessage, "pending");
  else setStatus("");
  setBusy(Boolean(snapshot.statusMessage));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Checking Jellyfin server...", "pending");
  setBusy(true);
  try {
    snapshot = await window.serverManagerApi.save({
      url: serverUrl.value,
      replacingId,
    });
    render();
  } catch (error) {
    setStatus(errorMessage(error));
    setBusy(false);
  }
});

showAdd.addEventListener("click", beginAdd);
cancelEdit.addEventListener("click", cancelForm);
close.addEventListener("click", () => window.close());
window.serverManagerApi.onChanged((nextSnapshot) => {
  snapshot = nextSnapshot;
  render();
});

async function initialize() {
  try {
    snapshot = await window.serverManagerApi.load();
    render();
  } catch (error) {
    setStatus(`Could not load servers: ${errorMessage(error)}`);
    setBusy(true);
  }
}

initialize();
