from pathlib import Path
import re

source_path = Path('.github/scripts/restore_backup_features.py')
code = source_path.read_text(encoding='utf-8')
replacement = r'''backup_styles = "  backupDetail:{backgroundColor:'#f6f8fc',borderRadius:16,padding:14,marginVertical:8},backupCurrentLabel:{fontSize:12,color:'#6b7280',fontWeight:'700'},backupCurrentFile:{fontSize:15,color:'#202124',fontWeight:'700',marginTop:4},backupByteRow:{flexDirection:'row',justifyContent:'space-between',marginTop:12},backupByteText:{fontSize:12,color:'#4b5563',fontWeight:'600'},backupTrack:{height:8,borderRadius:4,backgroundColor:'#dce4f1',overflow:'hidden',marginTop:8},backupFill:{height:8,backgroundColor:BLUE,borderRadius:4},backupRemaining:{fontSize:12,color:'#666',marginTop:8},backupError:{fontSize:12,color:'#b3261e',marginTop:8},backupStats:{flexDirection:'row',justifyContent:'space-around',paddingVertical:12},backupStatValue:{fontSize:20,fontWeight:'800',color:'#202124',textAlign:'center'},backupStatLabel:{fontSize:11,color:'#777',marginTop:2},\n"
home = replace_once(home, "  subHeader:", backup_styles + "  subHeader:", 'backup styles')
'''
pattern = r"style_anchor = .*?home = replace_once\(home, style_anchor, style_new, 'backup styles'\)\n"
patched, count = re.subn(pattern, replacement, code, count=1, flags=re.S)
if count != 1:
    raise SystemExit('could not rewrite backup styles patch block')
exec(compile(patched, str(source_path), 'exec'), {'__name__': '__main__'})
