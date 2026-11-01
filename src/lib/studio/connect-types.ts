// Connections: where the studio sends finished work. Google Drive keeps the
// videos (every final render, drafts if asked), GitHub keeps each film's
// source in a tidy library repository. Shared by the server and the page;
// nothing here ever carries a token or a secret.

export type GoogleAccount = {
  email: string;
  name: string | null;
  folderName: string; // "Aerchain Studio"
  folderLink: string | null;
  active: boolean;
};

export type GithubRepo = { fullName: string; url: string; private: boolean };

export type ConnectionsStatus = {
  google: {
    // A Google Cloud OAuth client is set in .env.local (GOOGLE_CLIENT_ID and
    // GOOGLE_CLIENT_SECRET). Without one, the studio shows how to make it.
    configured: boolean;
    redirectUri: string; // what to register, for the address the studio is open at
    accounts: GoogleAccount[];
    autoDrafts: boolean; // also save drafts, not only final renders
  };
  github: {
    deviceFlow: boolean; // GITHUB_CLIENT_ID is set: anyone can sign in with a code
    ghAvailable: boolean; // this Mac's GitHub CLI is signed in
    connected: { login: string; via: "device" | "gh" } | null;
    owners: string[]; // the account and its organisations, for a new repository
    repo: GithubRepo | null;
    pending: { userCode: string; verificationUri: string; expiresAt: string } | null;
  };
};

// What happened to one film's last save, per connection.
export type SaveState =
  | { state: "none" }
  | { state: "saving"; step: string }
  | { state: "saved"; at: string; link: string | null; files?: { name: string; link: string }[] }
  | { state: "failed"; message: string; at: string };

export type FilmConnections = { drive: SaveState; github: SaveState };
