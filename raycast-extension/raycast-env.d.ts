/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Mailroom Folder - The folder that contains server.js. */
  "mailroomDir": string,
  /** Port - Port the Mailroom server listens on. */
  "port": string,
  /** Reading - Mark a conversation read when you open it in Raycast. */
  "markReadOnOpen": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `inbox` command */
  export type Inbox = ExtensionPreferences & {}
  /** Preferences accessible in the `open` command */
  export type Open = ExtensionPreferences & {}
  /** Preferences accessible in the `update` command */
  export type Update = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `inbox` command */
  export type Inbox = {}
  /** Arguments passed to the `open` command */
  export type Open = {}
  /** Arguments passed to the `update` command */
  export type Update = {}
}

