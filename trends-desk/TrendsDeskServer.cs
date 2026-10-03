// Starts the X Trends Desk server hidden if :3489 is down. Never opens a browser. Used by scheduled tasks.
using System;
using System.Diagnostics;
using System.Net;
using System.Threading;
class P {
  static bool Up() {
    try { var r=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3489/"); r.Timeout=2000; using(var x=r.GetResponse()){} return true; } catch { return false; }
  }
  static void Main() {
    for (int attempt=0; attempt<3 && !Up(); attempt++) {
      var si=new ProcessStartInfo("wsl.exe","-d Ubuntu -- bash /mnt/c/Users/jpana/watch-split/trends-ui.sh");
      si.CreateNoWindow=true; si.UseShellExecute=false; si.WindowStyle=ProcessWindowStyle.Hidden;
      try { Process.Start(si); } catch {}
      for (int i=0;i<60 && !Up();i++) Thread.Sleep(1000);
    }
  }
}
