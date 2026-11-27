// Selection Colors — native Windows eyedropper.
// Freezes the screen, shows it full-screen with a magnifier loupe, returns the clicked pixel.
// Compiled at runtime by Windows PowerShell 5.1 (Add-Type => C# 5: keep syntax conservative).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SCEye
{
    internal static class Native
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        public static void MakeDpiAware()
        {
            // Per-monitor v2 (Win10 1703+) so every coordinate is a physical pixel.
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) { return; } } catch (Exception) { }
            try { SetProcessDPIAware(); } catch (Exception) { }
        }
    }

    public static class Picker
    {
        private static Bitmap shot;
        private static Rectangle virt;
        private static string result = "";
        private static string lastHex = "";
        private static ApplicationContext ctx;
        private static List<Overlay> overlays = new List<Overlay>();

        public static string Run()
        {
            Native.MakeDpiAware();

            virt = SystemInformation.VirtualScreen;
            shot = new Bitmap(virt.Width, virt.Height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(shot))
            {
                g.CopyFromScreen(virt.Left, virt.Top, 0, 0, virt.Size, CopyPixelOperation.SourceCopy);
            }

            ctx = new ApplicationContext();
            foreach (Screen s in Screen.AllScreens)
            {
                Overlay o = new Overlay(s.Bounds);
                overlays.Add(o);
                o.Show();
            }

            // Esc / right-click watchdog that works even if Windows refuses to give us focus.
            Timer t = new Timer();
            t.Interval = 25;
            DateTime started = DateTime.UtcNow;
            t.Tick += delegate
            {
                if ((Native.GetAsyncKeyState(0x1B) & 0x8000) != 0) { Finish(""); }
                else if ((DateTime.UtcNow - started).TotalSeconds > 120) { Finish(""); }
            };
            t.Start();

            Point p = Cursor.Position;
            foreach (Overlay o in overlays)
            {
                if (o.Bounds.Contains(p)) { o.Activate(); Native.SetForegroundWindow(o.Handle); }
            }

            Application.Run(ctx);
            t.Stop();
            t.Dispose();
            foreach (Overlay o in overlays) { o.Dispose(); }
            shot.Dispose();
            return result;
        }

        internal static void Finish(string hex)
        {
            if (ctx == null) { return; }
            result = hex;
            foreach (Overlay o in overlays) { o.Hide(); }
            ApplicationContext c = ctx;
            ctx = null;
            c.ExitThread();
        }

        // Screen point (physical px) -> colour from the frozen shot, or null if outside.
        internal static string HexAt(Point screen)
        {
            int x = screen.X - virt.Left, y = screen.Y - virt.Top;
            if (x < 0 || y < 0 || x >= shot.Width || y >= shot.Height) { return null; }
            Color c = shot.GetPixel(x, y);
            return c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
        }

        internal static void Report(string hex)
        {
            if (hex == null || hex == lastHex) { return; }
            lastHex = hex;
            Console.Out.WriteLine("M " + hex);
            Console.Out.Flush();
        }

        internal static Bitmap Shot { get { return shot; } }
        internal static Rectangle Virt { get { return virt; } }
    }

    internal class Overlay : Form
    {
        private const int Cells = 11;      // pixels sampled across the loupe
        private const int Zoom = 11;       // screen px per sampled px
        private const int LoupeSize = Cells * Zoom;
        private const int LabelH = 22;
        private readonly Rectangle screenBounds;
        private Rectangle loupeRect = Rectangle.Empty;
        private Point mouse = new Point(-1000, -1000);
        private bool pressed;

        public Overlay(Rectangle bounds)
        {
            screenBounds = bounds;
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            KeyPreview = true;
            Bounds = bounds;
            Cursor = Cursors.Cross;
            BackColor = Color.Black;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Opaque, true);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            Bounds = screenBounds; // re-apply after handle creation (DPI changes can resize)
            Point p = PointToClient(Cursor.Position);
            if (ClientRectangle.Contains(p)) { Track(p); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Rectangle src = new Rectangle(screenBounds.X - Picker.Virt.X, screenBounds.Y - Picker.Virt.Y, screenBounds.Width, screenBounds.Height);
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.DrawImage(Picker.Shot, new Rectangle(0, 0, screenBounds.Width, screenBounds.Height), src, GraphicsUnit.Pixel);
            if (loupeRect != Rectangle.Empty) { DrawLoupe(g); }
        }

        private void DrawLoupe(Graphics g)
        {
            Point screen = new Point(screenBounds.X + mouse.X, screenBounds.Y + mouse.Y);
            Rectangle zoom = new Rectangle(loupeRect.X, loupeRect.Y, LoupeSize, LoupeSize);
            Rectangle src = new Rectangle(screen.X - Picker.Virt.X - Cells / 2, screen.Y - Picker.Virt.Y - Cells / 2, Cells, Cells);

            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            using (SolidBrush bg = new SolidBrush(Color.FromArgb(30, 30, 30)))
            {
                g.FillRectangle(bg, loupeRect);
            }
            g.DrawImage(Picker.Shot, zoom, src, GraphicsUnit.Pixel);

            using (Pen grid = new Pen(Color.FromArgb(40, 255, 255, 255)))
            {
                for (int i = 1; i < Cells; i++)
                {
                    g.DrawLine(grid, zoom.X + i * Zoom, zoom.Y, zoom.X + i * Zoom, zoom.Bottom);
                    g.DrawLine(grid, zoom.X, zoom.Y + i * Zoom, zoom.Right, zoom.Y + i * Zoom);
                }
            }
            Rectangle center = new Rectangle(zoom.X + (Cells / 2) * Zoom, zoom.Y + (Cells / 2) * Zoom, Zoom, Zoom);
            using (Pen w = new Pen(Color.White, 2)) { g.DrawRectangle(w, center); }
            using (Pen k = new Pen(Color.Black, 1)) { g.DrawRectangle(k, Rectangle.Inflate(center, 2, 2)); }

            string hex = Picker.HexAt(screen);
            if (hex != null)
            {
                Rectangle label = new Rectangle(loupeRect.X, zoom.Bottom, LoupeSize, LabelH);
                Color c = ColorTranslator.FromHtml("#" + hex);
                using (SolidBrush b = new SolidBrush(Color.FromArgb(30, 30, 30))) { g.FillRectangle(b, label); }
                using (SolidBrush sw = new SolidBrush(c)) { g.FillRectangle(sw, label.X + 6, label.Y + 5, 12, 12); }
                using (Font f = new Font("Segoe UI", 12f, FontStyle.Regular, GraphicsUnit.Pixel))
                using (SolidBrush tb = new SolidBrush(Color.White))
                {
                    g.DrawString("#" + hex, f, tb, label.X + 24, label.Y + 3);
                }
            }
            using (Pen border = new Pen(Color.FromArgb(200, 255, 255, 255))) { g.DrawRectangle(border, loupeRect.X, loupeRect.Y, loupeRect.Width - 1, loupeRect.Height - 1); }
        }

        private void Track(Point p)
        {
            Rectangle old = loupeRect;
            mouse = p;
            int w = LoupeSize, h = LoupeSize + LabelH, gap = 24;
            int x = p.X + gap, y = p.Y + gap;
            if (x + w > ClientSize.Width) { x = p.X - gap - w; }
            if (y + h > ClientSize.Height) { y = p.Y - gap - h; }
            loupeRect = new Rectangle(x, y, w, h);
            if (old != Rectangle.Empty) { Invalidate(Rectangle.Inflate(old, 3, 3)); }
            Invalidate(Rectangle.Inflate(loupeRect, 3, 3));
            Picker.Report(Picker.HexAt(new Point(screenBounds.X + p.X, screenBounds.Y + p.Y)));
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            Track(e.Location);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (loupeRect != Rectangle.Empty) { Invalidate(Rectangle.Inflate(loupeRect, 3, 3)); loupeRect = Rectangle.Empty; }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left) { pressed = true; }
            else { Picker.Finish(""); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            // Finish on mouse-up so the release isn't delivered to the app underneath.
            if (e.Button == MouseButtons.Left && pressed)
            {
                string hex = Picker.HexAt(new Point(screenBounds.X + e.X, screenBounds.Y + e.Y));
                Picker.Finish(hex ?? "");
            }
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Escape) { Picker.Finish(""); }
        }

        protected override bool ShowWithoutActivation { get { return false; } }
    }
}
