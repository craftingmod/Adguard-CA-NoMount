/// <reference lib="dom" />
import { exec } from "kernelsu"
import {
  certificateCommand,
  hasInjectionRule,
  injectionCommand,
} from "./status"

async function update(
  id: string,
  command: string,
  installed: (output: string) => boolean,
  labels: [string, string],
) {
  const badge = document.getElementById(id)!
  try {
    const { errno, stdout } = await exec(command)
    if (errno !== 0) throw new Error("Status query failed")
    const active = installed(stdout)
    badge.textContent = labels[active ? 0 : 1]
    badge.dataset.state = active ? "active" : "inactive"
  } catch {
    badge.textContent = "Unavailable"
    badge.dataset.state = "error"
    badge.title = "Open in KernelSU WebUI and check root access permissions."
  }
}

function refresh() {
  void update(
    "certificate",
    certificateCommand,
    (output) => output.trim() === "installed",
    ["Installed", "Not installed"],
  )
  void update("injection", injectionCommand, hasInjectionRule, [
    "Active",
    "Inactive",
  ])
}

refresh()
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh()
})
