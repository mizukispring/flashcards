// Shared-mode backend (Firebase Auth + Firestore).
// Loaded as an ES module. If firebase-config.js does not define a config,
// the app stays in local (this-device-only) mode.
const V = "13.3.0";
const base = "https://www.gstatic.com/firebasejs/" + V + "/";
const cfg = window.FIREBASE_CONFIG;
const ADMINS = (window.FLASHCARD_ADMIN_EMAILS || []).map((e) => String(e).toLowerCase());

function done(api) {
  window.cloud = api;
  if (typeof window.__cloudResolve === "function") window.__cloudResolve(api);
}

if (!cfg || !cfg.apiKey || !cfg.projectId) {
  done({ configured: false });
} else {
  try {
    const [{ initializeApp }, authMod, fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);
    const app = initializeApp(cfg);
    const auth = authMod.getAuth(app);
    let db;
    try {
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch (e) {
      db = fs.getFirestore(app);
    }
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    authMod.getRedirectResult(auth).catch(() => {});

    const lower = (s) => String(s || "").trim().toLowerCase();
    const userInfo = (u) =>
      u ? { uid: u.uid, email: lower(u.email), name: u.displayName || "", verified: !!u.emailVerified } : null;

    done({
      configured: true,
      onAuth(cb) {
        return authMod.onAuthStateChanged(auth, (u) => cb(userInfo(u)));
      },
      async signIn() {
        try {
          await authMod.signInWithPopup(auth, provider);
        } catch (e) {
          const code = (e && e.code) || "";
          if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
            await authMod.signInWithRedirect(auth, provider);
            return;
          }
          if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
          throw e;
        }
      },
      signOut() {
        return authMod.signOut(auth);
      },
      isAdmin(user) {
        return !!(user && ADMINS.indexOf(user.email) >= 0);
      },
      async getMembers() {
        const s = await fs.getDoc(fs.doc(db, "config", "members"));
        return s.exists() && Array.isArray(s.data().emails) ? s.data().emails.map(lower) : [];
      },
      async setMembers(list) {
        const emails = Array.from(new Set(list.map(lower).filter(Boolean)));
        await fs.setDoc(fs.doc(db, "config", "members"), { emails });
        return emails;
      },
      // Members can read the members doc; anyone else is refused by the rules.
      async checkMember(user) {
        if (!user) return false;
        if (ADMINS.indexOf(user.email) >= 0) return true;
        try {
          const list = await this.getMembers();
          return list.indexOf(user.email) >= 0;
        } catch (e) {
          return false;
        }
      },
      subscribeCards(next, error) {
        return fs.onSnapshot(
          fs.collection(db, "cards"),
          (snap) => next(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())), snap.metadata.fromCache),
          (e) => error && error(e)
        );
      },
      writeCard(id, data) {
        return fs.setDoc(fs.doc(db, "cards", id), data);
      },
      deleteCard(id) {
        return fs.deleteDoc(fs.doc(db, "cards", id));
      },
      async getImage(id) {
        const s = await fs.getDoc(fs.doc(db, "images", id));
        return s.exists() ? s.data().data : null;
      },
      putImage(id, dataURL, uid) {
        return fs.setDoc(fs.doc(db, "images", id), { data: dataURL, by: uid || "", at: Date.now() });
      },
      deleteImage(id) {
        return fs.deleteDoc(fs.doc(db, "images", id));
      },
      async getUserState(uid) {
        const s = await fs.getDoc(fs.doc(db, "users", uid));
        return s.exists() ? s.data() : null;
      },
      setUserState(uid, patch) {
        return fs.setDoc(fs.doc(db, "users", uid), patch, { merge: true });
      },
      async getMeta(name) {
        const s = await fs.getDoc(fs.doc(db, "meta", name));
        return s.exists() ? s.data() : null;
      },
      setMeta(name, data) {
        return fs.setDoc(fs.doc(db, "meta", name), data, { merge: true });
      },
    });
  } catch (e) {
    console.warn("cloud unavailable", e);
    done({ configured: true, failed: true });
  }
}
