import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assertPrivateWindowsAcl } from "../src/windows-key-acl.mjs";
const user = "S-1-5-21-123-1000";
const privateAcl = () => ({ owner: user, current: user, access: [user, "S-1-5-18", "S-1-5-32-544"].map((sid) => ({ sid, allow: true })) });
describe("Windows operator-key ACL", () => {
  it("permits only the current owner and OS-privileged identities", () => { assert.doesNotThrow(() => assertPrivateWindowsAcl(privateAcl())); });
  it("refuses broad inherited groups or another user", () => {
    for (const sid of ["S-1-1-0", "S-1-5-32-545", "S-1-5-21-123-2000"]) {
      const acl = privateAcl(); acl.access.push({ sid, allow: true });
      assert.throws(() => assertPrivateWindowsAcl(acl), /another identity/);
    }
  });
  it("fails closed for missing ACL data, an unexpected owner or an unresolvable entry", () => {
    for (const acl of [null, {}, { ...privateAcl(), owner: "S-1-5-21-other" }, { ...privateAcl(), access: [{}] }]) assert.throws(() => assertPrivateWindowsAcl(acl), /permissions/);
  });
  it("does not interpret a deny entry as an access grant", () => {
    const acl = privateAcl(); acl.access.push({ sid: "S-1-1-0", allow: false }); assert.doesNotThrow(() => assertPrivateWindowsAcl(acl));
  });
});
