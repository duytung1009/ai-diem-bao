declare namespace chrome.scripting {
  interface ScriptInjection {
    id: string;
    matches: string[];
    js: string[];
    runAt: 'document_start' | 'document_end' | 'document_idle';
    persistAcrossSessions?: boolean;
  }
  interface RegisteredScript {
    id: string;
    matches: string[];
    js: string[];
    runAt: string;
    persistAcrossSessions: boolean;
  }
  function registerContentScripts(scripts: ScriptInjection[]): Promise<void>;
  function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  function getRegisteredContentScripts(): Promise<RegisteredScript[]>;
}

declare namespace chrome.permissions {
  interface Permissions {
    origins?: string[];
  }
  function request(permissions: Permissions, callback: (granted: boolean) => void): void;
  function contains(permissions: Permissions, callback: (result: boolean) => void): void;
  function remove(permissions: Permissions): Promise<boolean>;
}

declare namespace chrome.runtime {
  const lastError: { message: string } | undefined;
  interface InstalledDetails {
    reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update';
  }
  const onInstalled: {
    addListener(callback: (details: InstalledDetails) => void): void;
  };
}
