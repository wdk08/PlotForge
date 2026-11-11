use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const CHUNK: usize = 4 * 1024 * 1024;
const MAX_ASSET: u64 = 512 * 1024 * 1024;
const MAX_EXPORT: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Failure {
    pub name: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Failure>;

impl Failure {
    pub fn new(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            name,
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Self::new("StorageError", error.to_string())
    }
}
impl From<serde_json::Error> for Failure {
    fn from(error: serde_json::Error) -> Self {
        Self::new("StorageError", error.to_string())
    }
}
fn invalid(message: &'static str) -> Failure {
    Failure::new("StorageError", message)
}
fn conflict() -> Failure {
    Failure::new("StorageConflictError", "This project changed in another window. Export your current work as a copy before reopening.")
}
pub fn text<'a>(body: &'a Value, key: &str) -> Result<&'a str> {
    body[key]
        .as_str()
        .ok_or_else(|| invalid("A required storage field is missing."))
}
fn uuid(key: &str) -> Result<&str> {
    if Uuid::parse_str(key).is_ok_and(|id| id.to_string() == key) {
        Ok(key)
    } else {
        Err(invalid("Invalid storage ID."))
    }
}
fn read_json(path: &Path) -> Result<Value> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(error) => Err(error.into()),
    }
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(
        path.parent()
            .ok_or_else(|| invalid("Missing storage folder."))?,
    )?
    .sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
// Reuse the copied project's recovery strategy. Stage beside the destination,
// sync the bytes, then atomically rename so a crash leaves a complete revision.
fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut pending = NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| invalid("Missing storage folder."))?,
    )?;
    serde_json::to_writer(&mut pending, value)?;
    pending.as_file().sync_all()?;
    pending.persist(path).map_err(|error| error.error)?;
    sync_parent(path)
}
fn optional_metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(info) if !info.is_file() => {
            Err(invalid("Select a regular file as the export destination."))
        }
        Ok(info) => Ok(Some(info)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

struct Upload {
    file: NamedTempFile,
    path: PathBuf,
    before: Option<fs::Metadata>,
    expected: u64,
    written: u64,
}
impl Upload {
    fn chunk(&mut self, bytes: &[u8]) -> Result<()> {
        if bytes.is_empty()
            || bytes.len() > CHUNK
            || self.written + bytes.len() as u64 > self.expected
        {
            return Err(invalid("Invalid upload chunk."));
        }
        self.file.write_all(bytes)?;
        self.written += bytes.len() as u64;
        Ok(())
    }
    fn finish(self) -> Result<()> {
        if self.written != self.expected {
            return Err(invalid("The uploaded file is incomplete."));
        }
        self.file.as_file().sync_all()?;
        if let Some(before) = self.before {
            let after = optional_metadata(&self.path)?;
            if !after.is_some_and(|info| {
                before.len() == info.len() && before.modified().ok() == info.modified().ok()
            }) {
                return Err(Failure::new(
                    "FileConflictError",
                    "The destination changed while exporting.",
                ));
            }
            self.file.as_file().set_permissions(before.permissions())?;
            self.file.persist(&self.path).map_err(|error| error.error)?;
        } else {
            self.file
                .persist_noclobber(&self.path)
                .map_err(|error| error.error)?;
        }
        sync_parent(&self.path)
    }
}

pub struct Store {
    root: PathBuf,
    uploads: Mutex<HashMap<String, Upload>>,
}

pub fn storage_root(base: &Path, development: bool) -> PathBuf {
    base.join(if development {
        "development"
    } else {
        "production"
    })
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        for directory in ["projects", "assets", "versions", "preferences"] {
            fs::create_dir_all(root.join(directory))?;
        }
        Ok(Self {
            root,
            uploads: Mutex::default(),
        })
    }
    fn project_path(&self, key: &str) -> Result<PathBuf> {
        Ok(self
            .root
            .join("projects")
            .join(format!("{}.json", uuid(key)?)))
    }
    fn asset_path(&self, key: &str) -> Result<PathBuf> {
        Ok(self.root.join("assets").join(uuid(key)?))
    }
    fn lock(&self) -> Result<File> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join("write.lock"))?;
        file.lock()?;
        Ok(file)
    }
    fn save_record(&self, action: &str, body: &Value) -> Result<Value> {
        let _lock = self.lock()?;
        let supplied = &body["record"];
        let path = self.project_path(text(if action == "put" { supplied } else { body }, "id")?)?;
        let previous = read_json(&path)?;
        if previous["revision"] != body["revision"] {
            return Err(conflict());
        }
        let revision = previous["revision"].as_u64().unwrap_or(0) + 1;
        let mut record = match action {
            "put"
                if supplied["id"] == supplied["recovery"]["document"]["id"]
                    && previous["deletedAt"].is_null() =>
            {
                supplied.clone()
            }
            "archive" if !previous.is_null() && previous["deletedAt"].is_null() => {
                let mut record = previous;
                record["deletedAt"] = json!(SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis());
                record
            }
            "restore" if !previous["deletedAt"].is_null() => {
                let mut record = previous;
                record["deletedAt"] = Value::Null;
                record
            }
            _ => return Err(conflict()),
        };
        record["revision"] = json!(revision);
        write_json(&path, &record)?;
        Ok(json!({ "revision": revision, "id": record["id"] }))
    }
    fn preference_path(&self, body: &Value) -> Result<PathBuf> {
        let key = text(body, "key")?;
        if !matches!(key, "backup-settings" | "library-sort") {
            return Err(invalid("Unknown preference."));
        }
        Ok(self.root.join("preferences").join(format!("{key}.json")))
    }
    fn read_directory(&self, name: &str) -> Result<Vec<Value>> {
        let mut values = Vec::new();
        for item in fs::read_dir(self.root.join(name))? {
            let path = item?.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let value = read_json(&path)?;
                if !value.is_null() {
                    values.push(value);
                }
            }
        }
        Ok(values)
    }
    pub fn start_export(&self, path: PathBuf, size: u64) -> Result<Value> {
        let before = optional_metadata(&path)?;
        self.start_upload(path, before, size, MAX_EXPORT)
    }
    fn start_upload(
        &self,
        path: PathBuf,
        before: Option<fs::Metadata>,
        size: u64,
        limit: u64,
    ) -> Result<Value> {
        if size == 0 || size > limit {
            return Err(invalid("This file exceeds PlotForge's size limit."));
        }
        let file = NamedTempFile::new_in(
            path.parent()
                .ok_or_else(|| invalid("Missing destination folder."))?,
        )?;
        let token = Uuid::new_v4().to_string();
        self.uploads
            .lock()
            .map_err(|_| invalid("Storage is busy."))?
            .insert(
                token.clone(),
                Upload {
                    file,
                    path,
                    before,
                    expected: size,
                    written: 0,
                },
            );
        Ok(json!(token))
    }
    pub fn chunk(&self, token: &str, bytes: &[u8]) -> Result<()> {
        self.uploads
            .lock()
            .map_err(|_| invalid("Storage is busy."))?
            .get_mut(token)
            .ok_or_else(|| invalid("Upload session expired."))?
            .chunk(bytes)
    }
    pub fn asset_chunk(&self, id: &str, offset: u64, length: usize) -> Result<Vec<u8>> {
        if length == 0 || length > CHUNK || offset > MAX_ASSET {
            return Err(invalid("Invalid media read."));
        }
        let mut file = File::open(self.asset_path(id)?)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }
    pub fn run(&self, action: &str, body: &Value) -> Result<Value> {
        match action {
            "get" => read_json(&self.project_path(text(body, "id")?)?),
            "list" => {
                let mut records = self.read_directory("projects")?;
                records.retain(|record| record["deletedAt"].is_null());
                for record in &mut records {
                    if let Some(fields) = record.as_object_mut() {
                        fields.remove("recovery");
                    }
                }
                Ok(json!(records))
            }
            "put" | "archive" | "restore" => self.save_record(action, body),
            "getPreference" => read_json(&self.preference_path(body)?),
            "setPreference" => {
                write_json(&self.preference_path(body)?, &body["value"])?;
                Ok(Value::Null)
            }
            "assetSize" => Ok(json!(optional_metadata(
                &self.asset_path(text(body, "id")?)?
            )?
            .map(|info| info.len()))),
            "beginAsset" => self.start_upload(
                self.asset_path(text(body, "id")?)?,
                None,
                body["size"].as_u64().unwrap_or(0),
                MAX_ASSET,
            ),
            "finishUpload" | "cancelUpload" => {
                let upload = self
                    .uploads
                    .lock()
                    .map_err(|_| invalid("Storage is busy."))?
                    .remove(text(body, "token")?);
                if action == "finishUpload" {
                    upload
                        .ok_or_else(|| invalid("Upload session expired."))?
                        .finish()?;
                }
                Ok(Value::Null)
            }
            "addVersion" => {
                let version = &body["version"];
                let key = uuid(text(version, "id")?)?;
                uuid(text(version, "projectId")?)?;
                write_json(
                    &self.root.join("versions").join(format!("{key}.json")),
                    version,
                )?;
                Ok(Value::Null)
            }
            "listVersions" => {
                let key = uuid(text(body, "id")?)?;
                Ok(json!(self
                    .read_directory("versions")?
                    .into_iter()
                    .filter(|version| version["projectId"] == key)
                    .collect::<Vec<_>>()))
            }
            "removeVersions" => {
                for value in body["ids"]
                    .as_array()
                    .ok_or_else(|| invalid("Missing versions."))?
                {
                    let key = uuid(
                        value
                            .as_str()
                            .ok_or_else(|| invalid("Invalid version ID."))?,
                    )?;
                    match fs::remove_file(self.root.join("versions").join(format!("{key}.json"))) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                Ok(Value::Null)
            }
            _ => Err(invalid("Unknown storage operation.")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_revisions_survive_restart_in_their_own_profile() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("com.plotforge.desktop");
        let prod = storage_root(&app, false);
        let dev = storage_root(&app, true);
        let project = Uuid::new_v4().to_string();
        let record =
            json!({"id": project, "title": "Story", "recovery": {"document": {"id": project}}});
        let request = json!({"record": record, "revision": null});
        let store = Store::new(prod.clone()).unwrap();
        assert_eq!(store.run("put", &request).unwrap()["revision"], 1);
        let other = Store::new(prod.clone()).unwrap();
        assert_eq!(
            other.run("put", &request).unwrap_err().name,
            "StorageConflictError"
        );
        let key = json!({"id": project});
        assert_eq!(other.run("get", &key).unwrap()["title"], "Story");
        assert!(Store::new(dev).unwrap().run("get", &key).unwrap().is_null());
        assert!(!dir.path().join("com.scriptforge.desktop").exists());
        assert!(!dir.path().join("com.scribeforge.desktop").exists());
        let revision = json!({"id": project, "revision": 1});
        assert_eq!(other.run("archive", &revision).unwrap()["revision"], 2);
        assert_eq!(other.run("list", &Value::Null).unwrap(), json!([]));
        assert_eq!(
            store
                .run("restore", &json!({"id": project, "revision": 2}))
                .unwrap()["revision"],
            3
        );
    }

    #[test]
    fn media_writes_commit_only_after_the_complete_binary_arrives() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let id = Uuid::new_v4().to_string();
        let args = json!({"id": id, "size": 5});
        let token = store.run("beginAsset", &args).unwrap();
        store.chunk(token.as_str().unwrap(), b"ab").unwrap();
        assert!(store.run("assetSize", &args).unwrap().is_null());
        assert!(store.run("finishUpload", &json!({"token": token})).is_err());
        let token = store.run("beginAsset", &args).unwrap();
        store.chunk(token.as_str().unwrap(), b"abcde").unwrap();
        store.run("finishUpload", &json!({"token": token})).unwrap();
        assert_eq!(store.asset_chunk(&id, 1, 3).unwrap(), b"bcd");
        assert!(store.asset_chunk("../projects", 0, 1).is_err());
    }
}
