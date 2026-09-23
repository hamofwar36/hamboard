//! Sequential, uncompressed Hamboard archive. No asset bytes cross the webview bridge.
use serde_json::Value;
use std::path::Path;
use tauri::Manager;

#[cfg(target_os = "windows")]
mod platform {
    use std::{os::windows::ffi::OsStrExt, path::Path};
    #[repr(C)]
    struct MemoryStatus { length:u32, load:u32, total_phys:u64, avail_phys:u64, total_page:u64, avail_page:u64, total_virtual:u64, avail_virtual:u64, extended:u64 }
    #[link(name="kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(path:*const u16, available:*mut u64, total:*mut u64, free:*mut u64)->i32;
        fn GlobalMemoryStatusEx(status:*mut MemoryStatus)->i32;
        fn MoveFileExW(from:*const u16,to:*const u16,flags:u32)->i32;
    }
    fn wide(path:&Path)->Vec<u16>{path.as_os_str().encode_wide().chain(Some(0)).collect()}
    pub fn disk(path:&Path)->Result<u64,String>{let mut existing=if path.is_file(){path.parent().ok_or("backup-volume-unavailable")?}else{path};while !existing.exists(){existing=existing.parent().ok_or("backup-volume-unavailable")?}let name=wide(existing);let mut available=0; if unsafe{GetDiskFreeSpaceExW(name.as_ptr(),&mut available,std::ptr::null_mut(),std::ptr::null_mut())}==0{return Err("backup-disk-space-query-failed".into())}Ok(available)}
    pub fn memory(bytes:u64)->Result<(),String>{let mut value=MemoryStatus{length:std::mem::size_of::<MemoryStatus>() as u32,load:0,total_phys:0,avail_phys:0,total_page:0,avail_page:0,total_virtual:0,avail_virtual:0,extended:0};if unsafe{GlobalMemoryStatusEx(&mut value)}==0{return Err("backup-memory-query-failed".into())}if bytes>value.avail_phys.min(value.avail_virtual)/2{return Err("backup-insufficient-memory".into())}Ok(())}
    pub fn replace(from:&Path,to:&Path)->Result<(),String>{let a=wide(from);let b=wide(to);if unsafe{MoveFileExW(a.as_ptr(),b.as_ptr(),1|8)}==0{return Err(std::io::Error::last_os_error().to_string())}Ok(())}
}
pub fn ensure_disk(path:&Path,bytes:u64)->Result<(),String>{
    if bytes>9_007_199_254_740_991{return Err("backup-resource-size-invalid".into())}
    #[cfg(target_os="windows")]{let required=bytes.checked_add(64*1024*1024).ok_or("backup-resource-size-overflow")?;if required>platform::disk(path)?{return Err("backup-insufficient-disk-space".into())}}
    #[cfg(not(target_os="windows"))]{let _=(path,bytes);return Err("backup-resource-platform-unavailable".into())}
    #[allow(unreachable_code)] Ok(())
}
pub fn ensure_memory(bytes:u64)->Result<(),String>{
    #[cfg(target_os="windows")]{return platform::memory(bytes)}
    #[cfg(not(target_os="windows"))]{let _=bytes;Err("backup-resource-platform-unavailable".into())}
}
#[tauri::command]
pub fn backup_resource_guard(app:tauri::AppHandle,bytes:u64,path:Option<String>,memory_bytes:Option<u64>)->Result<(),String>{if let Some(memory)=memory_bytes{ensure_memory(memory)?;}let directory=app.path().app_local_data_dir().map_err(|e|e.to_string())?;ensure_disk(path.as_deref().map(Path::new).unwrap_or(&directory),bytes)}

#[cfg(target_os="windows")]
mod archive {
    use super::*;
    use std::{fs::{self,File,OpenOptions},io::{Read,Write,Seek},path::PathBuf,collections::HashSet};
    use sha2::{Digest,Sha256};
    use serde_json::json;
    const MAGIC:&[u8;8]=b"HMBACK03";
    fn err(e:impl std::fmt::Display)->String{e.to_string()}
    fn name(value:&str)->Result<(),String>{if value.is_empty()||value.len()>200||!value.bytes().all(|c|c.is_ascii_alphanumeric()||b"._-".contains(&c)){return Err("backup-entry-name-invalid".into())}Ok(())}
    fn source(base:&Path,relative:&str)->Result<PathBuf,String>{let parts:Vec<_>=Path::new(relative).components().collect();if parts.len()!=2||parts[0].as_os_str()!="assets"||!matches!(parts[1],std::path::Component::Normal(_)){return Err("backup-source-path-invalid".into())}let root=base.join("assets").canonicalize().map_err(err)?;let path=base.join(relative).canonicalize().map_err(err)?;if !path.starts_with(root)||!path.is_file(){return Err("backup-source-path-invalid".into())}Ok(path)}
    fn copy_hash(input:&mut impl Read,output:&mut impl Write,length:u64)->Result<[u8;32],String>{let mut left=length;let mut buffer=vec![0u8;1024*1024];let mut hash=Sha256::new();while left>0{let count=left.min(buffer.len() as u64) as usize;input.read_exact(&mut buffer[..count]).map_err(err)?;output.write_all(&buffer[..count]).map_err(err)?;hash.update(&buffer[..count]);left-=count as u64}Ok(hash.finalize().into())}
    fn write_entry(output:&mut File,name:&str,input:&mut impl Read,length:u64)->Result<(),String>{output.write_all(&(name.len() as u32).to_le_bytes()).map_err(err)?;output.write_all(name.as_bytes()).map_err(err)?;output.write_all(&length.to_le_bytes()).map_err(err)?;let hash=copy_hash(input,output,length)?;output.write_all(&hash).map_err(err)}
    pub fn write(app:tauri::AppHandle,path:String,manifest:Value,entries:Vec<Value>)->Result<(),String>{
        let base=app.path().app_local_data_dir().map_err(err)?;let target=PathBuf::from(path);let parent=target.parent().ok_or("backup-target-invalid")?;
        let content=serde_json::to_vec(&manifest).map_err(err)?;let mut needed=content.len() as u64+1024;let mut files=Vec::new();let mut seen=HashSet::from(["manifest.json".to_string()]);
        for entry in entries{let key=entry["name"].as_str().ok_or("backup-entry-invalid")?.to_string();name(&key)?;if !seen.insert(key.clone()){return Err("backup-entry-duplicate".into())}let source=source(&base,entry["relativePath"].as_str().ok_or("backup-entry-invalid")?)?;let size=fs::metadata(&source).map_err(err)?.len();needed=needed.checked_add(size+key.len() as u64+44).ok_or("backup-size-overflow")?;files.push((key,source,size))}
        ensure_disk(parent,needed)?;
        let temporary=parent.join(format!(".hamboard-backup-{:016x}.partial",rand::random::<u64>()));
        let result=(||{let mut out=OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(err)?;out.write_all(MAGIC).map_err(err)?;out.write_all(&((files.len()+1) as u64).to_le_bytes()).map_err(err)?;write_entry(&mut out,"manifest.json",&mut content.as_slice(),content.len() as u64)?;
            for (key,path,size) in files{ensure_disk(parent,size)?;let mut file=File::open(path).map_err(err)?;if file.metadata().map_err(err)?.len()!=size{return Err("backup-source-changed".into())}write_entry(&mut out,&key,&mut file,size)?}out.sync_all().map_err(err)?;drop(out);platform::replace(&temporary,&target)})();if result.is_err(){let _=fs::remove_file(&temporary);}result
    }
    pub fn read(app:tauri::AppHandle,path:String)->Result<Value,String>{
        let base=app.path().app_local_data_dir().map_err(err)?;let assets=base.join("assets");fs::create_dir_all(&assets).map_err(err)?;
        let mut file=File::open(path).map_err(err)?;let length=file.metadata().map_err(err)?.len();ensure_disk(&assets,length.checked_mul(2).ok_or("backup-size-overflow")?)?;
        let mut magic=[0;8];file.read_exact(&mut magic).map_err(err)?;if &magic!=MAGIC{return Err("backup-archive-format-invalid".into())}let mut number=[0;8];file.read_exact(&mut number).map_err(err)?;let count=u64::from_le_bytes(number);if count==0||count>length/45{return Err("backup-entry-count-invalid".into())}
        let prefix=format!("archive-import-{:016x}-",rand::random::<u64>());let mut paths=Vec::new();
        let result=(||{let mut manifest=Value::Null;let mut entries=Vec::new();let mut seen=HashSet::new();
            for index in 0..count{let mut size=[0;4];file.read_exact(&mut size).map_err(err)?;let size=u32::from_le_bytes(size) as usize;if size==0||size>200{return Err("backup-entry-name-invalid".into())}let mut key=vec![0;size];file.read_exact(&mut key).map_err(err)?;let key=String::from_utf8(key).map_err(err)?;name(&key)?;if !seen.insert(key.clone()){return Err("backup-entry-duplicate".into())}file.read_exact(&mut number).map_err(err)?;let bytes=u64::from_le_bytes(number);let remaining=length.saturating_sub(file.stream_position().map_err(err)?);if bytes>remaining.saturating_sub(32){return Err("backup-entry-size-invalid".into())}ensure_disk(&assets,bytes)?;
                let hash=if index==0{if key!="manifest.json"{return Err("backup-manifest-missing".into())}ensure_memory(bytes.checked_mul(8).ok_or("backup-size-overflow")?)?;let mut content=Vec::new();content.try_reserve(usize::try_from(bytes).map_err(err)?).map_err(err)?;let hash=copy_hash(&mut file,&mut content,bytes)?;manifest=serde_json::from_slice(&content).map_err(err)?;hash}else{let relative=format!("assets/{prefix}{index}.bin");let path=base.join(&relative);let mut out=OpenOptions::new().write(true).create_new(true).open(&path).map_err(err)?;paths.push(path);let hash=copy_hash(&mut file,&mut out,bytes)?;out.sync_all().map_err(err)?;entries.push(json!({"name":key,"relativePath":relative,"byteSize":bytes}));hash};let mut expected=[0;32];file.read_exact(&mut expected).map_err(err)?;if hash!=expected{return Err("backup-entry-integrity-mismatch".into())}
            }
            if file.stream_position().map_err(err)?!=length{return Err("backup-archive-trailing-data".into())}Ok(json!({"manifest":manifest,"files":entries}))})();if result.is_err(){for path in paths{let _=fs::remove_file(path);}}result
    }
}
#[tauri::command]
pub async fn backup_archive_write(app:tauri::AppHandle,path:String,manifest:Value,entries:Vec<Value>)->Result<(),String>{
    #[cfg(target_os="windows")]{return tauri::async_runtime::spawn_blocking(move||archive::write(app,path,manifest,entries)).await.map_err(|e|e.to_string())?}
    #[cfg(not(target_os="windows"))]{let _=(app,path,manifest,entries);Err("backup-archive-platform-unavailable".into())}
}
#[tauri::command]
pub async fn backup_archive_read(app:tauri::AppHandle,path:String)->Result<Value,String>{
    #[cfg(target_os="windows")]{return tauri::async_runtime::spawn_blocking(move||archive::read(app,path)).await.map_err(|e|e.to_string())?}
    #[cfg(not(target_os="windows"))]{let _=(app,path);Err("backup-archive-platform-unavailable".into())}
}

#[tauri::command]
pub async fn backup_stage_asset(app:tauri::AppHandle,source_relative_path:String,target_relative_path:String)->Result<u64,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let base=app.path().app_local_data_dir().map_err(|e|e.to_string())?;let assets=base.join("assets").canonicalize().map_err(|e|e.to_string())?;
        let valid=|value:&str|{let parts:Vec<_>=Path::new(value).components().collect();parts.len()==2&&parts[0].as_os_str()=="assets"&&matches!(parts[1],std::path::Component::Normal(_))};
        if !valid(&source_relative_path)||!valid(&target_relative_path)||!target_relative_path.starts_with("assets/restore-staging-"){return Err("backup-stage-path-invalid".into())}
        let source=base.join(source_relative_path).canonicalize().map_err(|e|e.to_string())?;if !source.starts_with(&assets){return Err("backup-stage-path-invalid".into())}
        let target=base.join(target_relative_path);let length=std::fs::metadata(&source).map_err(|e|e.to_string())?.len();ensure_disk(&assets,length)?;
        use std::io::{Read,Write};let mut input=std::fs::File::open(source).map_err(|e|e.to_string())?;let mut out=std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e|e.to_string())?;
        let result=(||{let mut buffer=vec![0;1024*1024];let mut total=0;loop{let count=input.read(&mut buffer).map_err(|e|e.to_string())?;if count==0{break}ensure_disk(&assets,count as u64)?;out.write_all(&buffer[..count]).map_err(|e|e.to_string())?;total+=count as u64;if total>length{return Err("backup-stage-source-changed".into())}}if total!=length{return Err("backup-stage-source-changed".into())}out.sync_all().map_err(|e|e.to_string())?;Ok(total)})();drop(out);if result.is_err(){let _=std::fs::remove_file(target);}result
    }).await.map_err(|e|e.to_string())?
}

pub fn read_version_page(directory:&Path,page:&Value)->Result<Vec<Value>,String>{
    #[cfg(target_os="windows")]{
        use sha2::{Digest,Sha256};use std::io::Read;
        let relative=page["relativePath"].as_str().ok_or("backup-version-page-path-invalid")?;
        let name=relative.strip_prefix("assets/").ok_or("backup-version-page-path-invalid")?;
        if name.contains('/')||name.contains('\\')||name.contains("..")||!(name.starts_with("archive-import-")||name.starts_with("cloud-download-")){return Err("backup-version-page-path-invalid".into())}
        let path=directory.join(name).canonicalize().map_err(|e|e.to_string())?;
        if !path.starts_with(directory.canonicalize().map_err(|e|e.to_string())?){return Err("backup-version-page-path-invalid".into())}
        let size=page["byteSize"].as_u64().ok_or("backup-version-page-size-invalid")?;
        if std::fs::metadata(&path).map_err(|e|e.to_string())?.len()!=size{return Err("backup-version-page-size-invalid".into())}
        ensure_memory(size.checked_mul(8).ok_or("backup-version-page-size-invalid")?)?;
        let mut input=std::fs::File::open(&path).map_err(|e|e.to_string())?;let mut buffer=vec![0;1024*1024];let mut hash=Sha256::new();loop{let count=input.read(&mut buffer).map_err(|e|e.to_string())?;if count==0{break}hash.update(&buffer[..count])}
        let actual=format!("{:x}",hash.finalize());if page["contentSha256"].as_str()!=Some(actual.as_str()){return Err("backup-version-page-integrity-mismatch".into())}
        let reader=std::io::BufReader::new(std::fs::File::open(path).map_err(|e|e.to_string())?);
        return serde_json::from_reader(reader).map_err(|e|e.to_string());
    }
    #[cfg(not(target_os="windows"))]{let _=(directory,page);Err("backup-resource-platform-unavailable".into())}
}
