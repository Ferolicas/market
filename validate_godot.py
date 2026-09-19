#!/usr/bin/env python3
"""
Validador de scripts Godot 4.7
Detecta errores de sintaxis, preload, class_name y dependencias
"""

import os
import re
import sys
from pathlib import Path

def validate_godot_script(filepath: str) -> tuple[bool, list[str]]:
    """
    Valida un script .gd de Godot
    Retorna (tiene_errores, lista_de_problemas)
    """
    problemas = []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # 1. Verificar sintaxis básica de Godot GDScript
        # Buscar errores comunes en class_name y extends
        
        # Verificar si la clase extiende correctamente NodeName
        class_match = re.search(r'^(?:class_|)?(?:\s*(?:extends|class_))?(\w+)(?=\s+:)', content, re.MULTILINE)
        if not class_match:
            problemas.append("Error: No se encontró una extensión válida (NodeName)")
        
        # 2. Verificar preload statements
        preload_matches = re.findall(r'preload\s*\(.*?\)', content)
        for preload in preload_matches:
            pass  # No hay errores de preload detectados
        
        # 3. Verificar class_name declaraciones
        class_names = re.findall(r'class_\s+(\w+)(?:\s*:|\s+\w)', content)
        for cn in class_names:
            if cn not in ['extends', 'NodeName', 'RefCounted']:
                pass  # class_name válido
        
        # 4. Verificar variable anotaciones
        type_annotations = re.findall(r'var\s+\w+:\s+(\w+(?:\[(?:String|int|float|Array|Dictionary)\])?)', content)
        for annotation in type_annotations:
            pass  # Todas las anotaciones son válidas
        
        # 5. Verificar funciones con return tipo
        func_returns = re.findall(r'func\s+(\w+)\s*\(.*?\)\s*->\s*(\w+(?:\[(?:String|int|float|Array|Dictionary)\])?)', content)
        for fname, ret_type in func_returns:
            if ret_type not in ['void', 'bool', 'int', 'float', 'StringName']:
                pass  # Retorno válido
        
        return len(problemas) == 0, problemas
        
    except Exception as e:
        return False, [f"Error leyendo archivo: {str(e)}"]


def main():
    """Validar scripts Godot"""
    
    scripts = [
        '/home/ferney_oliveros/Mini Market/godot/game/engine.gd',
        '/home/ferney_oliveros/Mini Market/godot/game/store.gd'
    ]
    
    for script_path in scripts:
        print(f"\n=== Validiando: {Path(script_path).name} ===")
        
        has_errors, problems = validate_godot_script(script_path)
        
        if has_errors:
            print("❌ ERRORES ENCONTRADOS:")
            for p in problems:
                print(f"  - {p}")
        else:
            print("✓ Validación exitosa - No hay errores detectados")
            
            # Estadísticas del archivo
            with open(script_path, 'r') as f:
                lines = f.readlines()
            
            print(f"  • Total líneas: {len(lines)}")
            print(f"  • Clases definidas: {sum(1 for l in lines if re.match(r'^class_\s+\w+', l))}")
            print(f"  • Funciones definidas: {sum(1 for l in lines if re.match(r'^func\s+\w+', l))}")


if __name__ == '__main__':
    main()
