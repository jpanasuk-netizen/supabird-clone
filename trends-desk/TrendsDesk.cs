using System;
using System.Diagnostics;
using System.Net;
using System.Threading;
class P {
  static bool Up() {
    try { var r=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3489/"); r.Timeout=1500; using(var x=r.GetResponse()){} return true; } catch { return false; }
  }
  [STAThread] static void Main() {
    if (!Up()) {
      var si=new ProcessStartInfo("wsl.exe","-d Ubuntu -- bash /mnt/c/Users/jpana/watch-split/trends-ui.sh");
      si.CreateNoWindow=true; si.UseShellExecute=false; si.WindowStyle=ProcessWindowStyle.Hidden;
      try { Process.Start(si); } catch {}
      for (int i=0;i<40 && !Up();i++) Thread.Sleep(500);
    }
    Process.Start(new ProcessStartInfo("http://localhost:3489"){UseShellExecute=true});
  }
}
