// Dashboard Monitoring Produksi BPS Kebumen (3305)
// Node http murni — tanpa dependensi. Jalankan: node server.js
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

const PORT=process.env.PORT||8200;
const ROOT=__dirname;
const PUB=path.join(ROOT,'public');
const DATA=path.join(ROOT,'data');
const UPL=path.join(ROOT,'uploads');
const DB=path.join(DATA,'db.json');
for(const d of [DATA,UPL])if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});

/* ============ SEED DATA (struktur mengikuti Google Sites 3305) ============ */
const FOTO=new Set();
const seed=()=>({
  users:[
    {u:'superadmin',p:'bps3305',role:'superadmin',n:'Super Admin BPS Kebumen'},
    {u:'admin',p:'bps3305',role:'admin',n:'Admin Statistik Produksi'},
    {u:'mitra',p:'mitra3305',role:'mitra',n:'Mitra Statistik'}
  ],
  // bidang (seperti 3 menu di Google Sites)
  bidang:[
    {id:'tp',nama:'Statistik Tanaman Pangan',ikon:'🌾',ket:'Survei KSA, Ubinan, SKGB, Konversi Gabah'},
    {id:'inpek',nama:'Statistik INPEK',ikon:'🏭',ket:'Industri, Pertambangan, Energi & Konstruksi'},
    {id:'horti',nama:'Statistik Horti, Perkebunan, Peternakan & Perikanan',ikon:'🐄',ket:'SPT, SKP, Komstrat, VIP Horti, DPP DUTL'}
  ],
  survei:[], progress:[], foto:[], aktivitas:[],
  meta:{instansi:'BPS Kabupaten Kebumen',unit:'Tim Statistik Produksi 3305',tahun:2026}
});

/* ---- seed survei mengikuti daftar di Google Sites ---- */
const SURVEI_SEED=[
  ['tp','Survei Kerangka Sampel Area (KSA) 2026','2026',890,120],
  ['tp','Survei Ubinan Subround 1 2026','2026',140,44],
  ['tp','Survei Ubinan Subround 2 2026','2026',140,26],
  ['tp','Survei Ubinan Subround 3 2026','2026',140,0],
  ['tp','Survei Konversi Jagung (SKJG) 2026','2026',96,52],
  ['tp','Survei Konversi Gabah ke Beras 2026','2026',64,30],
  ['tp','SKGB 3305 Tahun 2025','2025',210,210],
  ['tp','Survei Ubinan Subround 1 2025','2025',140,140],
  ['tp','Survei Ubinan Subround 2 2025','2025',140,138],
  ['tp','Survei Ubinan Subround 3 2025','2025',140,95],
  ['inpek','Survei IMK Tahunan 2026','2026',412,180],
  ['inpek','Survei IMK Triwulanan 2026','2026',126,48],
  ['inpek','Survei DPA, STPIM dan IBSTR 2026','2026',88,31],
  ['inpek','Survei Galian URT 2026','2026',74,22],
  ['inpek','Updating Direktori Perusahaan PE 2026','2026',310,145],
  ['inpek','Survei Konstruksi 2026','2026',58,18],
  ['inpek','Survei INPEK Triwulanan TW 4 2025','2025',96,96],
  ['inpek','Survei IBS Triwulan 3 2025','2025',42,42],
  ['inpek','Survei IMK Triwulan 3 2025','2025',126,126],
  ['inpek','Survei Galian BH Triwulan 3 2025','2025',38,38],
  ['inpek','Survei Konstruksi Triwulan 3 2025','2025',58,58],
  ['inpek','Survei IMK Tahunan 2025','2025',412,412],
  ['horti','Survei Pertanian Terintegrasi (SPT) 2026','2026',520,210],
  ['horti','Survei Kesejahteraan Petani (SKP)','2026',180,64],
  ['horti','Survei Komstrat 2026','2026',240,88],
  ['horti','Survei VIP - HORTI 2026','2026',165,52],
  ['horti','Survei DPP DUTL 2026','2026',132,40]
];

function build(){
  const d=seed();
  let n=1;
  for(const [bid,nama,tahun,target,selesai] of SURVEI_SEED){
    d.survei.push({
      id:'SV-'+String(n++).padStart(3,'0'),
      bidang:bid,nama,tahun,
      target,selesai,
      mulai:tahun+'-01-15', selesaiTarget:tahun+'-12-20',
      status: selesai>=target?'Selesai':(selesai===0?'Belum Mulai':'Berjalan'),
      pic:'Tim '+bid.toUpperCase(),
      linkSheet:'',linkForm:''
    });
  }
  d.aktivitas.push({t:Date.now(),oleh:'system',aksi:'Data awal dashboard dimuat',detail:'27 survei dari 3 bidang'});
  return d;
}
function load(){ if(!fs.existsSync(DB)){const d=build();fs.writeFileSync(DB,JSON.stringify(d,null,1));return d;} try{return JSON.parse(fs.readFileSync(DB,'utf8'));}catch(e){const d=build();fs.writeFileSync(DB,JSON.stringify(d,null,1));return d;} }
function save(d){ fs.writeFileSync(DB,JSON.stringify(d,null,1)); }

/* ============ AUTH (token in-memory) ============ */
const SESS=new Map();
function mkToken(){ return crypto.randomBytes(24).toString('hex'); }
function getUser(req){
  const h=req.headers.authorization||'';
  const t=h.startsWith('Bearer ')?h.slice(7):'';
  return SESS.get(t)||null;
}

/* ============ HELPERS ============ */
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8',
'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json;charset=utf-8'};
function json(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); }
function body(req,limit=8*1024*1024){ return new Promise((rs,rj)=>{ let n=0,ch=[]; req.on('data',c=>{ n+=c.length; if(n>limit){rj(new Error('too large'));return;} ch.push(c); }); req.on('end',()=>rs(Buffer.concat(ch))); req.on('error',rj); }); }
function magicOk(b){
  if(!b||b.length<12)return null;
  if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return 'png';
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return 'jpg';
  if(b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP')return 'webp';
  if(b.slice(0,3).toString()==='GIF')return 'gif';
  const s=b.slice(0,300).toString().trim();
  if(s.startsWith('<svg')||s.startsWith('<?xml'))return 'svg';
  return null;
}
const log=(d,oleh,aksi,detail)=>d.aktivitas.unshift({t:Date.now(),oleh,aksi,detail:detail||''});

/* ============ SERVER ============ */
const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://'+req.headers.host);
  const p=u.pathname;
  try{
    /* ---- AUTH ---- */
    if(p==='/api/login'&&req.method==='POST'){
      const j=JSON.parse((await body(req)).toString()||'{}');
      const d=load();
      const us=d.users.find(x=>x.u===(j.u||'').trim().toLowerCase()&&x.p===j.p);
      if(!us)return json(res,401,{ok:false,msg:'Username atau password salah'});
      const t=mkToken(); SESS.set(t,{u:us.u,role:us.role,n:us.n});
      log(d,us.n,'Login',us.role); save(d);
      return json(res,200,{ok:true,token:t,user:{u:us.u,role:us.role,n:us.n}});
    }
    if(p==='/api/me'){
      const me=getUser(req); if(!me)return json(res,401,{ok:false});
      return json(res,200,{ok:true,user:me});
    }
    if(p==='/api/logout'){ const h=req.headers.authorization||''; SESS.delete(h.slice(7)); return json(res,200,{ok:true}); }

    /* ---- DATA UTAMA ---- */
    if(p==='/api/data'){
      const d=load(); const me=getUser(req);
      const out={ok:true,meta:d.meta,bidang:d.bidang,survei:d.survei,foto:d.foto};
      if(me){ out.users=me.role==='superadmin'?d.users.map(x=>({u:x.u,role:x.role,n:x.n})):undefined; out.aktivitas=d.aktivitas.slice(0,60); }
      return json(res,200,out);
    }

    /* ---- SURVEI CRUD (admin & superadmin) ---- */
    if(p==='/api/survei'&&req.method==='POST'){
      const me=getUser(req); if(!me||me.role==='mitra')return json(res,403,{ok:false,msg:'Hanya admin'});
      const j=JSON.parse((await body(req)).toString());
      const d=load();
      if(j.del){
        d.survei=d.survei.filter(x=>x.id!==j.del);
        log(d,me.n,'Hapus survei',j.del); save(d); return json(res,200,{ok:true});
      }
      if(j.id){
        const s=d.survei.find(x=>x.id===j.id); if(!s)return json(res,404,{ok:false});
        Object.assign(s,{nama:j.nama??s.nama,bidang:j.bidang??s.bidang,tahun:+(j.tahun??s.tahun),
          target:+(j.target??s.target),selesai:+(j.selesai??s.selesai),status:j.status??s.status,
          pic:j.pic??s.pic,mulai:j.mulai??s.mulai,selesaiTarget:j.selesaiTarget??s.selesaiTarget,
          linkSheet:j.linkSheet??s.linkSheet,linkForm:j.linkForm??s.linkForm});
        log(d,me.n,'Update survei',s.nama); save(d); return json(res,200,{ok:true,survei:s});
      }
      const nid='SV-'+String(d.survei.length+1).padStart(3,'0');
      const ns={id:nid,nama:j.nama||'Survei Baru',bidang:j.bidang||'tp',tahun:+(j.tahun||d.meta.tahun),
        target:+(j.target||0),selesai:+(j.selesai||0),status:j.status||'Belum Mulai',pic:j.pic||'',
        mulai:j.mulai||'',selesaiTarget:j.selesaiTarget||'',linkSheet:j.linkSheet||'',linkForm:j.linkForm||''};
      d.survei.push(ns); log(d,me.n,'Tambah survei',ns.nama); save(d);
      return json(res,200,{ok:true,survei:ns});
    }

    /* ---- PROGRESS (mitra boleh input) ---- */
    if(p==='/api/progress'&&req.method==='POST'){
      const me=getUser(req); if(!me)return json(res,401,{ok:false});
      const j=JSON.parse((await body(req)).toString());
      const d=load(); const s=d.survei.find(x=>x.id===j.surveiId); if(!s)return json(res,404,{ok:false});
      const val=Math.max(0,Math.min(+(j.selesai||0),s.target));
      s.selesai=val; s.status=val>=s.target?'Selesai':(val===0?'Belum Mulai':'Berjalan');
      d.progress.unshift({t:Date.now(),surveiId:s.id,oleh:me.n,role:me.role,sebelum:j.sebelum,sesudah:val,catatan:j.catatan||''});
      log(d,me.n,'Update progress',s.nama+' → '+val+'/'+s.target); save(d);
      return json(res,200,{ok:true,survei:s});
    }

    /* ---- MITRA (kelola user — superadmin saja) ---- */
    if(p==='/api/users'&&req.method==='POST'){
      const me=getUser(req); if(!me||me.role!=='superadmin')return json(res,403,{ok:false,msg:'Hanya superadmin'});
      const j=JSON.parse((await body(req)).toString());
      const d=load();
      if(j.del){ d.users=d.users.filter(x=>x.u!==j.del); log(d,me.n,'Hapus user',j.del); save(d); return json(res,200,{ok:true}); }
      const uu=(j.u||'').trim().toLowerCase();
      if(!uu||!j.p)return json(res,400,{ok:false,msg:'Username & password wajib'});
      if(d.users.some(x=>x.u===uu))return json(res,400,{ok:false,msg:'Username sudah ada'});
      d.users.push({u:uu,p:j.p,role:j.role||'mitra',n:j.n||uu});
      log(d,me.n,'Tambah user',uu+' ('+(j.role||'mitra')+')'); save(d);
      return json(res,200,{ok:true});
    }

    /* ---- UPLOAD FOTO ---- */
    if(p==='/api/upload'&&req.method==='POST'){
      const me=getUser(req); if(!me)return json(res,401,{ok:false});
      const buf=await body(req);
      const ext=magicOk(buf);
      if(!ext)return json(res,400,{ok:false,msg:'Hanya gambar PNG/JPG/WEBP/GIF/SVG'});
      const name='foto_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex')+'.'+ext;
      fs.writeFileSync(path.join(UPL,name),buf);
      const d=load();
      const meta={file:name,judul:(u.searchParams.get('judul')||'Dokumentasi')+'',surveiId:u.searchParams.get('surveiId')||'',
        oleh:me.n,role:me.role,t:Date.now(),size:buf.length};
      d.foto.unshift(meta); log(d,me.n,'Upload foto',meta.judul); save(d);
      return json(res,200,{ok:true,foto:meta,url:'/uploads/'+name});
    }
    if(p==='/api/foto/delete'&&req.method==='POST'){
      const me=getUser(req); if(!me||me.role==='mitra')return json(res,403,{ok:false});
      const j=JSON.parse((await body(req)).toString());
      const d=load(); const f=d.foto.find(x=>x.file===j.file); if(!f)return json(res,404,{ok:false});
      try{fs.unlinkSync(path.join(UPL,f.file));}catch(e){}
      d.foto=d.foto.filter(x=>x.file!==j.file); log(d,me.n,'Hapus foto',f.judul); save(d);
      return json(res,200,{ok:true});
    }

    /* ---- META / SETTINGS ---- */
    if(p==='/api/meta'&&req.method==='POST'){
      const me=getUser(req); if(!me||me.role==='mitra')return json(res,403,{ok:false});
      const j=JSON.parse((await body(req)).toString());
      const d=load(); Object.assign(d.meta,{instansi:j.instansi??d.meta.instansi,unit:j.unit??d.meta.unit,tahun:+(j.tahun??d.meta.tahun)});
      log(d,me.n,'Update pengaturan',''); save(d); return json(res,200,{ok:true,meta:d.meta});
    }

    /* ---- EXPORT CSV REKAP ---- */
    if(p==='/api/export'){
      const me=getUser(req); if(!me)return json(res,401,{ok:false});
      const d=load();
      const rows=[['Bidang','Survei','Tahun','Target','Selesai','Persen','Status','PIC']];
      for(const s of d.survei){ const b=d.bidang.find(x=>x.id===s.bidang);
        rows.push([b?b.nama:s.bidang,s.nama,s.tahun,s.target,s.selesai,(s.target?Math.round(s.selesai/s.target*100):0)+'%',s.status,s.pic]); }
      const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
      res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment;filename="rekap-monitoring-3305.csv"'});
      return res.end('\uFEFF'+csv);
    }

    /* ---- STATIC ---- */
    if(p.startsWith('/uploads/')){ const f=path.join(UPL,path.basename(p)); if(fs.existsSync(f)){ res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'public,max-age=86400'}); return res.end(fs.readFileSync(f)); } return json(res,404,{ok:false}); }
    let f=path.join(PUB,p==='/'?'index.html':p);
    if(p==='/admin')f=path.join(PUB,'admin.html');
    if(p==='/mitra')f=path.join(PUB,'mitra.html');
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,'index.html');
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/html;charset=utf-8','Cache-Control':'no-cache'});
    res.end(fs.readFileSync(f));
  }catch(e){ try{json(res,500,{ok:false,msg:e.message});}catch(_){} }
});

server.listen(PORT,()=>{ load(); console.log('Dashboard BPS 3305 jalan di http://localhost:'+PORT); });
