using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Observability
{
    public interface IGameTelemetry
    {
        void Track(string category,string name,IReadOnlyDictionary<string,string> fields=null);
        void TrackError(string category,string name,Exception exception);
    }

    // Safe integration point for a future crash/analytics SDK. It emits only
    // coarse technical fields and never state JSON, email, cookies or tokens.
    public sealed class UnityGameTelemetry : IGameTelemetry
    {
        public void Track(string category,string name,IReadOnlyDictionary<string,string> fields=null)
        {
            if(!Debug.isDebugBuild)return;
            var suffix="";
            if(fields!=null)foreach(var field in fields)suffix+=$" {field.Key}={field.Value}";
            Debug.Log($"{category} event={name}{suffix}");
        }

        public void TrackError(string category,string name,Exception exception)
            =>Debug.LogError($"{category} event={name} error={exception.GetType().Name}");
    }
}
