#!/usr/bin/env python3
"""
GPU Usage Monitoring Script for TTS Service

Monitors GPU utilization while running TTS synthesis to verify
that CUDA acceleration is actually being used.

Usage: python test_gpu_usage.py
"""

import subprocess
import time
import threading
import sys
from datetime import datetime
import requests

# Configuration
TTS_BASE_URL = "http://localhost:8000"
MONITORING_INTERVAL = 0.5  # seconds
TEST_TEXT = "this is a test from GPU monitoring"


class GPUMonitor:
    def __init__(self):
        self.monitoring = False
        self.gpu_data = []
        self.monitor_thread = None

    def check_nvidia_smi(self):
        """Check if nvidia-smi is available"""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--version"], capture_output=True, text=True, timeout=5
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False

    def get_gpu_stats(self):
        """Get current GPU statistics"""
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    (
                        "--query-gpu=timestamp,name,memory.used,memory.total,"
                        "utilization.gpu,utilization.memory,temperature.gpu,power.draw"
                    ),
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")
                stats = []
                for line in lines:
                    if line.strip():
                        parts = [part.strip() for part in line.split(",")]
                        if len(parts) >= 8:
                            stats.append(
                                {
                                    "timestamp": parts[0],
                                    "name": parts[1],
                                    "memory_used": (
                                        int(parts[2]) if parts[2] != "[N/A]" else 0
                                    ),
                                    "memory_total": (
                                        int(parts[3]) if parts[3] != "[N/A]" else 0
                                    ),
                                    "gpu_util": (
                                        int(parts[4]) if parts[4] != "[N/A]" else 0
                                    ),
                                    "memory_util": (
                                        int(parts[5]) if parts[5] != "[N/A]" else 0
                                    ),
                                    "temperature": (
                                        int(parts[6]) if parts[6] != "[N/A]" else 0
                                    ),
                                    "power_draw": (
                                        float(parts[7]) if parts[7] != "[N/A]" else 0.0
                                    ),
                                }
                            )
                return stats
            else:
                return None
        except (subprocess.TimeoutExpired, FileNotFoundError, ValueError) as e:
            print(f"Error getting GPU stats: {e}")
            return None

    def monitor_gpu(self):
        """Continuously monitor GPU usage"""
        while self.monitoring:
            stats = self.get_gpu_stats()
            if stats:
                timestamp = datetime.now()
                for i, stat in enumerate(stats):
                    self.gpu_data.append(
                        {"local_timestamp": timestamp, "gpu_id": i, **stat}
                    )
            time.sleep(MONITORING_INTERVAL)

    def start_monitoring(self):
        """Start GPU monitoring in a separate thread"""
        if not self.check_nvidia_smi():
            print("❌ nvidia-smi not available. Cannot monitor GPU usage.")
            return False

        print("🔍 Starting GPU monitoring...")
        self.monitoring = True
        self.gpu_data = []
        self.monitor_thread = threading.Thread(target=self.monitor_gpu)
        self.monitor_thread.daemon = True
        self.monitor_thread.start()
        return True

    def stop_monitoring(self):
        """Stop GPU monitoring"""
        print("⏹ Stopping GPU monitoring...")
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=2)

    def analyze_results(self):
        """Analyze the collected GPU data"""
        if not self.gpu_data:
            print("❌ No GPU data collected")
            return

        print(f"\n📊 GPU Usage Analysis ({len(self.gpu_data)} samples)")
        print("=" * 60)

        # Group by GPU
        gpu_groups = {}
        for entry in self.gpu_data:
            gpu_id = entry["gpu_id"]
            if gpu_id not in gpu_groups:
                gpu_groups[gpu_id] = []
            gpu_groups[gpu_id].append(entry)

        for gpu_id, data in gpu_groups.items():
            if not data:
                continue

            print(f"\nGPU {gpu_id}: {data[0]['name']}")
            print("-" * 40)

            # Calculate statistics
            gpu_utils = [entry["gpu_util"] for entry in data]
            memory_utils = [entry["memory_util"] for entry in data]
            memory_used = [entry["memory_used"] for entry in data]
            temperatures = [entry["temperature"] for entry in data]
            power_draws = [
                entry["power_draw"] for entry in data if entry["power_draw"] > 0
            ]

            print("GPU Utilization:")
            print(f"  Max: {max(gpu_utils)}%")
            print(f"  Avg: {sum(gpu_utils)/len(gpu_utils):.1f}%")
            print(f"  Min: {min(gpu_utils)}%")

            print("Memory Utilization:")
            print(f"  Max: {max(memory_utils)}%")
            print(f"  Avg: {sum(memory_utils)/len(memory_utils):.1f}%")
            print(f"  Min: {min(memory_utils)}%")

            print("Memory Usage:")
            print(f"  Max: {max(memory_used)} MB")
            print(f"  Avg: {sum(memory_used)/len(memory_used):.0f} MB")
            print(f"  Min: {min(memory_used)} MB")

            if temperatures:
                print("Temperature:")
                print(f"  Max: {max(temperatures)}°C")
                print(f"  Avg: {sum(temperatures)/len(temperatures):.1f}°C")

            if power_draws:
                print("Power Draw:")
                print(f"  Max: {max(power_draws):.1f}W")
                print(f"  Avg: {sum(power_draws)/len(power_draws):.1f}W")

            # Check if GPU was actually used
            max_util = max(gpu_utils)

            if max_util > 50:
                print(
                    f"✅ GPU was heavily utilized (max {max_util}%) - CUDA acceleration "
                    "confirmed!"
                )
            elif max_util > 10:
                print(
                    f"✅ GPU was moderately utilized (max {max_util}%) - CUDA likely "
                    "working"
                )
            elif max_util > 0:
                print(
                    f"⚠️  GPU had minimal utilization (max {max_util}%) - may not be "
                    "using CUDA"
                )
            else:
                print("❌ GPU showed no utilization - CUDA may not be working")


def test_tts_with_monitoring():
    """Test TTS synthesis while monitoring GPU usage"""
    monitor = GPUMonitor()

    print("🧪 Testing TTS Service with GPU Monitoring")
    print("=" * 60)

    # Start monitoring
    if not monitor.start_monitoring():
        return False

    # Wait a moment to collect baseline
    print("📈 Collecting baseline GPU usage...")
    time.sleep(2)

    try:
        # Check TTS service health
        print("\n🏥 Checking TTS service health...")
        health_response = requests.get(f"{TTS_BASE_URL}/health", timeout=10)
        health_response.raise_for_status()
        health_data = health_response.json()

        print(f"Service Status: {health_data.get('status')}")
        print(f"CUDA Available: {health_data.get('chatterbox_available', False)}")

        if health_data.get("status") != "healthy":
            print("❌ TTS service is not healthy, aborting test")
            return False

        # Perform TTS synthesis
        print(f"\n🗣️  Synthesizing speech: '{TEST_TEXT}'")
        synthesis_start = time.time()

        synthesis_response = requests.post(
            f"{TTS_BASE_URL}/synthesize",
            json={
                "text": TEST_TEXT,
                "voice": "caspar",
                "exaggeration": 0.5,
                "cfg_weight": 0.5,
            },
            timeout=120,
        )
        synthesis_response.raise_for_status()

        synthesis_time = time.time() - synthesis_start
        synthesis_data = synthesis_response.json()

        print(f"✅ Synthesis completed in {synthesis_time:.2f} seconds")
        print(f"✓ Audio ID: {synthesis_data.get('audio_id')}")
        print(f"✓ Audio Path: {synthesis_data.get('audio_path')}")
        print(f"✓ Status: {synthesis_data.get('status')}")
        print(f"✓ Sample Rate: {synthesis_data.get('sample_rate')} Hz")
        print(f"✓ Duration: {synthesis_data.get('duration')} seconds")
        print(f"✓ Generation Time: {synthesis_data.get('generation_time')} seconds")
        print(f"✓ File Size: {synthesis_data.get('file_size')} bytes")

        # Give a moment for final GPU stats to be collected
        time.sleep(1)

        return True

    except requests.RequestException as e:
        print(f"❌ TTS request failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False
    finally:
        # Stop monitoring and analyze
        monitor.stop_monitoring()
        monitor.analyze_results()


def main():
    """Main function"""
    print("🚀 GPU Usage Monitor for TTS Service")
    print(f"Timestamp: {datetime.now()}")
    print(f"Target: {TTS_BASE_URL}")

    # Check if nvidia-smi is available
    monitor = GPUMonitor()
    if not monitor.check_nvidia_smi():
        print("\n❌ nvidia-smi is not available on this system.")
        print("Cannot monitor GPU usage without NVIDIA GPU and drivers.")
        print("This script requires:")
        print("  - NVIDIA GPU")
        print("  - NVIDIA drivers installed")
        print("  - nvidia-smi command available")
        return 1

    # Show initial GPU status
    print("\n🖥️  Initial GPU Status:")
    initial_stats = monitor.get_gpu_stats()
    if initial_stats:
        for i, stat in enumerate(initial_stats):
            print(f"GPU {i}: {stat['name']}")
            print(f"  Memory: {stat['memory_used']}/{stat['memory_total']} MB")
            print(f"  Utilization: {stat['gpu_util']}%")
            print(f"  Temperature: {stat['temperature']}°C")

    # Run the test
    success = test_tts_with_monitoring()

    if success:
        print("\n🎉 GPU monitoring test completed successfully!")
        return 0
    else:
        print("\n❌ GPU monitoring test failed!")
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
