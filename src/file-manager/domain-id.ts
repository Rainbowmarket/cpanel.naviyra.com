let activeTarget = "";

export function setFileManagerTarget(target: string) {
  activeTarget = target;
}

export function getFileManagerTarget() {
  return activeTarget;
}

/** @deprecated use setFileManagerTarget */
export function setFileManagerDomainId(domainId: string) {
  setFileManagerTarget(domainId.startsWith("d:") || domainId.startsWith("s:") ? domainId : `d:${domainId}`);
}

/** @deprecated use getFileManagerTarget */
export function getFileManagerDomainId() {
  return activeTarget;
}
