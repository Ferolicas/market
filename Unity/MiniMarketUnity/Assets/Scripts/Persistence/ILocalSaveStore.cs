using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Persistence
{
    public enum LocalSaveReadStatus
    {
        Missing,
        Current,
        Previous,
        Temporary,
        Legacy,
        Corrupt,
    }

    public sealed class LocalSaveReadResult
    {
        public LocalSaveReadStatus Status { get; }
        public JObject Envelope { get; }
        public string Detail { get; }
        public bool HasSave => Envelope != null;

        public LocalSaveReadResult(LocalSaveReadStatus status, JObject envelope = null, string detail = "")
        {
            Status = status;
            Envelope = envelope;
            Detail = detail ?? "";
        }
    }

    public interface ILocalSaveStore
    {
        string Description { get; }
        Task<LocalSaveReadResult> ReadAsync(CancellationToken cancellationToken = default);
        Task WriteAsync(JObject envelope, CancellationToken cancellationToken = default);
        Task WriteConflictBackupAsync(JObject envelope, CancellationToken cancellationToken = default);
    }
}
